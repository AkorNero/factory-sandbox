import { createContext, useContext, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * Drag a Task onto an Event, a day chip, Anytime or the Someday tab, or an Event onto a day chip.
 * Mouse: the drag starts once the pointer has moved a few pixels.
 * Touch: press and hold starts it; a finger that moves before the hold is up is a scroll and the page scrolls normally.
 * No rules in here: the core is asked whether a drop is allowed, and told what was dropped.
 *
 * touch-action: draggable elements say `manipulation` (see styles.css), never `none`. `none` would make every pill
 * and Event card a place where the page cannot be scrolled. The browser reads touch-action once, when the finger
 * lands, so it cannot be switched to `none` when the hold is up. Instead, until the hold is up the browser is
 * free to scroll (and then cancels the pointer, which cancels the drag), and once it is up the non-passive
 * `touchmove` listener below stops the scroll that would otherwise follow. It is registered once at mount, not
 * at touchstart, because iOS Safari ignores a preventDefault from a listener added during the gesture.
 */

export interface DragSource {
  /** A Task (the default) or an Event. */
  kind?: 'task' | 'event';
  id: string;
  label: string;
}

/** What a drop target is: an Event, a day chip, the Anytime block of the day shown, or the Someday tab. */
export type DropTarget =
  | { kind: 'event'; id: string }
  | { kind: 'day'; date: string }
  | { kind: 'anytime' }
  | { kind: 'someday' };

/** The `data-drop` value of a target, and back. */
export const parseDrop = (value: string): DropTarget | null => {
  if (value === 'anytime') return { kind: 'anytime' };
  if (value === 'someday') return { kind: 'someday' };
  if (value.startsWith('event:')) return { kind: 'event', id: value.slice(6) };
  if (value.startsWith('day:')) return { kind: 'day', date: value.slice(4) };
  return null;
};

interface Dragger {
  /** Spread on the element that can be picked up. */
  dragProps: (source: DragSource) => { onPointerDown: (e: PointerEvent) => void; 'data-draggable': true };
}

const HOLD_MS = 380;
const SLOP_PX = 7;
/** Presses on these never start a drag: they are controls of their own. */
const CONTROLS = 'input,select,textarea,[data-tick],[data-nodrag]';

const DragContext = createContext<Dragger>({
  dragProps: () => ({ onPointerDown: () => {}, 'data-draggable': true }),
});
export const useDrag = () => useContext(DragContext);

/** Mark an element as a drop target. What `onDrop` gets back is the parsed target. */
export const eventDrop = (eventId: string) => ({ 'data-drop': `event:${eventId}` });
export const dayDrop = (date: string) => ({ 'data-drop': `day:${date}` });
export const anytimeDrop = { 'data-drop': 'anytime' };

export const somedayDrop = { 'data-drop': 'someday' };

interface Press {
  source: DragSource;
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  over: HTMLElement | null;
}

export function DragProvider({
  canDrop,
  onDrop,
  children,
}: {
  canDrop: (source: DragSource, target: DropTarget) => boolean;
  onDrop: (source: DragSource, target: DropTarget) => void;
  children: ReactNode;
}) {
  const latest = useRef({ canDrop, onDrop });
  latest.current = { canDrop, onDrop };
  const press = useRef<Press | null>(null);
  const [ghost, setGhost] = useState<{ kind?: 'task' | 'event'; label: string; x: number; y: number } | null>(null);

  const clearMarks = () => {
    delete document.body.dataset.dragging;
    for (const el of document.querySelectorAll<HTMLElement>('[data-drop-valid],[data-drop-over]')) {
      delete el.dataset.dropValid;
      delete el.dataset.dropOver;
    }
  };

  const stop = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    press.current = null;
    clearMarks();
    setGhost(null);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
  };

  const activate = (x: number, y: number) => {
    const p = press.current;
    if (!p || p.active) return;
    p.active = true;
    navigator.vibrate?.(15);
    document.body.dataset.dragging = 'true';
    for (const el of document.querySelectorAll<HTMLElement>('[data-drop]')) {
      const target = parseDrop(el.dataset.drop!);
      if (target && latest.current.canDrop(p.source, target)) el.dataset.dropValid = 'true';
    }
    setGhost({ kind: p.source.kind, label: p.source.label, x, y });
  };

  const hover = (x: number, y: number) => {
    const p = press.current!;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]') ?? null;
    const valid = target?.dataset.dropValid ? target : null;
    if (valid === p.over) return;
    if (p.over) delete p.over.dataset.dropOver;
    if (valid) valid.dataset.dropOver = 'true';
    p.over = valid;
  };

  function move(e: globalThis.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!p.active) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= SLOP_PX) return;
      if (p.touch) return stop(); // the finger moved before the hold was up: a scroll, not a drag
      activate(e.clientX, e.clientY);
    }
    setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
    hover(e.clientX, e.clientY);
  }

  function up(e: globalThis.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (p.active) {
      hover(e.clientX, e.clientY);
      const target = p.over ? parseDrop(p.over.dataset.drop!) : null;
      // the click that follows the release would open the tap menu of whatever is under the pointer
      const swallow = (ev: Event) => ev.stopPropagation();
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 80);
      const source = p.source;
      stop();
      if (target) latest.current.onDrop(source, target);
    } else stop();
  }

  function cancel(e: globalThis.PointerEvent) {
    if (press.current && e.pointerId === press.current.pointerId) stop();
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') stop();
  }

  const dragger = useMemo<Dragger>(
    () => ({
      dragProps: (source) => ({
        'data-draggable': true,
        onPointerDown: (e: PointerEvent) => {
          if (press.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
          if ((e.target as Element).closest(CONTROLS)) return;
          const touch = e.pointerType !== 'mouse';
          press.current = {
            source,
            pointerId: e.pointerId,
            touch,
            x: e.clientX,
            y: e.clientY,
            timer: touch ? setTimeout(() => activate(e.clientX, e.clientY), HOLD_MS) : null,
            active: false,
            over: null,
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', cancel);
          window.addEventListener('keydown', key);
        },
      }),
    }),
    // the handlers only touch refs and stable setState, so they never go stale
    [],
  );

  useEffect(() => {
    const noScroll = (e: TouchEvent) => {
      if (press.current?.active && e.cancelable) e.preventDefault();
    };
    // a long press on Android opens the context menu, on desktop a right-click must still work
    const noMenu = (e: Event) => {
      if (press.current?.touch) e.preventDefault();
    };
    window.addEventListener('touchmove', noScroll, { passive: false });
    window.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener('touchmove', noScroll);
      window.removeEventListener('contextmenu', noMenu);
    };
  }, []);

  return (
    <DragContext.Provider value={dragger}>
      {children}
      {ghost && (
        <div className="ghost" aria-hidden="true" style={{ transform: `translate(${ghost.x + 12}px, ${ghost.y + 12}px)` }}>
          {ghost.kind === 'event' ? '▪' : '○'} {ghost.label}
        </div>
      )}
    </DragContext.Provider>
  );
}
