import {
  addDays,
  canDateTask,
  canMoveEvent,
  canPickDay,
  canPlace,
  dayView,
  today,
  type Command,
  type DayView,
  type ItemView,
  type State,
  type StripDay,
} from '@dayplanner/core';
import { useStatus } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Clock } from './clock.ts';
import { anytimeDrop, dayDrop, DragProvider, type DragSource, type DropTarget } from './drag.tsx';
import { DayEvents, DayTabs, EventMenu, NowAndNext, type EventActions } from './Events.tsx';
import { AddField, Pill, label, type ItemActions } from './Items.tsx';
import { runCommand, useStoreState } from './store/adapter.ts';

/** Local calendar math for labels only: dates are plain strings, so go through UTC to avoid timezone shifts. */
const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function App({ clock, db }: { clock: Clock; db: AbstractPowerSyncDatabase }) {
  const state = useStoreState();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => clock.subscribe(() => setNow(clock.now())), [clock]);

  const todayDate = today(now);
  // the day opened from the strip; Today until one is tapped (a day that has passed falls back to Today)
  const [opened, setOpened] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const date = opened && opened > todayDate ? opened : todayDate;
  const view = useMemo(() => (state ? dayView(state, date, now, picked) : null), [state, date, now, picked]);
  const dayLabel = (d: string) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });

  const [eventMenuId, setEventMenuId] = useState<string | null>(null);
  const menuEvent = state?.events.find((e) => e.id === eventMenuId) ?? null;
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuItem = view && menuId ? everyItem(view).find((i) => i.id === menuId) : undefined;
  const run = (command: Command) => runCommand(db, command, clock.now());
  const tick = (item: ItemView) => run({ type: item.completedTime ? 'untickTask' : 'tickTask', id: item.id });

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  const eventTitle = (id: string) => state?.events.find((e) => e.id === id)?.title ?? '';
  const actions: EventActions = {
    onTick: tick,
    onOpen: setMenuId,
    open: setEventMenuId,
    onAddTask: async (eventId, title) => {
      await run({ type: 'addTask', id: crypto.randomUUID(), title, date, eventId });
      setToast(`Added “${title}” in ${eventTitle(eventId)}`);
    },
  };

  return (
    <DragProvider
      canDrop={(source, target) => !!state && canDrop(state, date, source, target)}
      onDrop={async (source: DragSource, target: DropTarget) => {
        if (source.kind === 'event') {
          if (target.kind !== 'day') return;
          await run({ type: 'moveEvent', id: source.id, date: target.date });
          setToast(`Moved “${source.label}” to ${dayLabel(target.date)} with its placed Tasks`);
        } else if (target.kind === 'event') {
          await run({ type: 'placeTask', id: source.id, eventId: target.id });
          setToast(`Placed “${source.label}” in ${eventTitle(target.id)}`);
        } else {
          const to = target.kind === 'day' ? target.date : date;
          await run({ type: 'dateTask', id: source.id, date: to });
          setToast(`Dated “${source.label}” to ${dayLabel(to)}`);
        }
      }}
    >
      <main className="main">
        <header className="top">
          <h1>{fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <SyncBadge />
        </header>
        {view && (
          <>
            <Strip
              days={view.strip}
              selected={view.date}
              now={now}
              onOpen={(d) => setOpened(d === todayDate ? null : d)}
              onPick={(d) => {
                setPicked((p) => (p.includes(d) ? p : [...p, d]));
                setOpened(d);
              }}
              onRemove={(d) => {
                setPicked((p) => p.filter((x) => x !== d));
                if (opened === d) setOpened(null);
              }}
            />
            {view.isToday && <NowAndNext view={view} actions={actions} />}
            {!view.isToday && (
              <DayEvents
                view={view}
                actions={actions}
                onAdd={(title, start, end) => run({ type: 'addEvent', id: crypto.randomUUID(), title, date, start, end })}
              />
            )}
            <Anytime
              view={view}
              dayName={fmt(date, { weekday: 'short' })}
              onAdd={(title) => run({ type: 'addTask', id: crypto.randomUUID(), title, date })}
              onTick={tick}
              onOpen={setMenuId}
            />
            <DoneToday view={view} onTick={tick} onOpen={setMenuId} />
            {menuItem && <TaskMenu item={menuItem} onClose={() => setMenuId(null)} run={run} />}
            {view.isToday && (
              <DayTabs
                view={view}
                actions={actions}
                onAdd={(title, start, end) => run({ type: 'addEvent', id: crypto.randomUUID(), title, date, start, end })}
              />
            )}
          </>
        )}
        {menuEvent && (
          <EventMenu
            key={menuEvent.id}
            event={menuEvent}
            onClose={() => setEventMenuId(null)}
            onSave={async (title, start, end) => {
              await run({ type: 'renameEvent', id: menuEvent.id, title });
              await run({ type: 'setEventTimes', id: menuEvent.id, start, end });
            }}
            onDelete={() => run({ type: 'deleteEvent', id: menuEvent.id })}
          />
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>
    </DragProvider>
  );
}

/** Everything on screen the tap menu can be opened for. */
const everyItem = (view: DayView): ItemView[] => [
  ...view.anytime.items,
  ...view.done.items,
  ...view.now.cards.flatMap((c) => c.tasks),
  ...(view.next?.events.flatMap((e) => e.tasks) ?? []),
  ...view.later.events.flatMap((e) => e.tasks),
  ...view.earlier.events.flatMap((e) => e.tasks),
];

function SyncBadge() {
  const s = useStatus();
  const label = s.connected ? (s.dataFlowStatus.uploading ? 'Syncing…' : 'Synced') : s.connecting ? 'Connecting…' : 'Offline';
  return (
    <span className={`sync ${s.connected ? 'on' : ''}`} data-testid="sync-status">
      {label}
    </span>
  );
}

/** Whether a drop is allowed, asked of the core. A drop on Anytime means "the day shown". */
function canDrop(state: State, shown: string, source: DragSource, target: DropTarget): boolean {
  if (source.kind === 'event') return target.kind === 'day' && canMoveEvent(state, source.id, target.date);
  switch (target.kind) {
    case 'event':
      return canPlace(state, source.id, target.id);
    case 'day':
      return canDateTask(state, source.id, target.date);
    case 'anytime':
      return canDateTask(state, source.id, shown);
  }
}

/** Today and the next 7 days, plus the days picked later. "Pick a day" sits after the strip, outside its scroll area. */
function Strip({
  days,
  selected,
  now,
  onOpen,
  onPick,
  onRemove,
}: {
  days: StripDay[];
  selected: string;
  now: string;
  onOpen: (date: string) => void;
  onPick: (date: string) => void;
  onRemove: (date: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const firstPickable = addDays(today(now), 8);
  return (
    <div className="stripbar">
      <nav className="strip" aria-label="Upcoming">
        {days.map((d, i) => (
          <div key={d.date} className="chipwrap">
            <button
              type="button"
              className={`chip ${d.date === selected ? 'sel' : ''}`}
              aria-pressed={d.date === selected}
              aria-label={`${i === 0 ? 'Today' : fmt(d.date, { weekday: 'long' })} ${fmt(d.date, { day: 'numeric', month: 'long' })}`}
              onClick={() => onOpen(d.date)}
              {...dayDrop(d.date)}
            >
              <span className="wd">{i === 0 ? 'Today' : fmt(d.date, { weekday: 'short' })}</span>
              <span className="dn">{fmt(d.date, { day: 'numeric' })}</span>
              <span className="dots" aria-label={`${d.events} events, ${d.tasks} tasks`}>
                {'▪'.repeat(Math.min(d.events, 4))}
                {'•'.repeat(Math.min(d.tasks, 4))}
              </span>
            </button>
            {canPickDay(now, d.date) && (
              <button type="button" className="chip-x" aria-label={`Remove ${fmt(d.date, { day: 'numeric', month: 'long' })}`} onClick={() => onRemove(d.date)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </nav>
      <button
        type="button"
        className="pick"
        onClick={() => {
          try {
            input.current?.showPicker();
          } catch {
            input.current?.focus();
          }
        }}
      >
        <span aria-hidden="true">📅</span> Pick a day
      </button>
      <input
        ref={input}
        type="date"
        className="pick-input"
        aria-label="Day to add to the strip"
        min={firstPickable}
        value=""
        onChange={(e) => canPickDay(now, e.target.value) && onPick(e.target.value)}
      />
    </div>
  );
}

const ANYTIME_SHOWN = 6;
const DONE_SHOWN = 4;

/** Pills that collapse to `limit` with a "+N more" / "Show less" button. */
function Collapsible({ items, limit, ...actions }: { items: ItemView[]; limit: number } & ItemActions) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  const more = items.length - limit;
  return (
    <ul className="pills">
      {shown.map((i) => (
        <Pill key={i.id} item={i} {...actions} />
      ))}
      {more > 0 && (
        <li>
          <button type="button" className="pill dashed more" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `+${more} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Anytime today; on another day the same block is "Not placed". A drop here dates a Task to the day shown. */
function Anytime({
  view,
  dayName,
  onAdd,
  ...actions
}: { view: DayView; dayName: string; onAdd: (title: string) => Promise<unknown> } & ItemActions) {
  return (
    <section aria-labelledby="anytime-h" className="anytime" {...anytimeDrop}>
      <h2 id="anytime-h" className="sec">
        {view.isToday ? 'Anytime today' : 'Not placed'} <span className="count" data-testid="anytime-count">{view.anytime.count}</span>
      </h2>
      <Collapsible items={view.anytime.items} limit={ANYTIME_SHOWN} {...actions} />
      <AddField placeholder={view.isToday ? '+ Task today' : `+ Task on ${dayName}`} onAdd={onAdd} />
    </section>
  );
}

function DoneToday({ view, ...actions }: { view: DayView } & ItemActions) {
  const { count, total, items } = view.done;
  if (total === 0) return null;
  return (
    <section aria-labelledby="done-h">
      <h2 id="done-h" className="sec">
        {view.isToday ? 'Done today' : 'Done'} <span className="count">{count}</span>
      </h2>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
        <div style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <p className="mute">
        {count} of {total} done
      </p>
      <Collapsible items={items} limit={DONE_SHOWN} {...actions} />
    </section>
  );
}

/** Tap menu (bottom sheet): rename, edit the Completion time of a done item, delete. */
function TaskMenu({ item, onClose, run }: { item: ItemView; onClose: () => void; run: (c: Command) => Promise<unknown> }) {
  const [title, setTitle] = useState(item.title);
  const [time, setTime] = useState(item.completedTime ?? '');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await run({ type: 'renameTask', id: item.id, title });
    if (item.completedTime && time) await run({ type: 'setCompletionTime', id: item.id, time });
    onClose();
  };
  const remove = async () => {
    await run({ type: 'deleteTask', id: item.id });
    onClose();
  };
  const takeOut = async () => {
    await run({ type: 'unplaceTask', id: item.id });
    onClose();
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-label="Edit task" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="grab" />
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        {item.completedTime && (
          <label>
            Completion time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
        {item.placement && <p className="mute">In {item.placement.title}</p>}
        <div className="actions">
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={onClose}>Cancel</button>
          {item.placement && (
            <button type="button" onClick={takeOut}>
              Take out of {item.placement.title}
            </button>
          )}
          <button type="button" className="danger" onClick={remove}>Delete</button>
        </div>
      </form>
    </div>
  );
}
