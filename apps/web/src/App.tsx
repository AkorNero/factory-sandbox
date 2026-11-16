import {
  addDays,
  canAddSubtask,
  canDateTask,
  canMoveEvent,
  canPickDay,
  canPlace,
  canRepeat,
  canUndate,
  dayView,
  recurrenceLabel,
  taskItem,
  today,
  type Command,
  type DayView,
  type ItemView,
  type RecurrenceRule,
  type State,
  type StripDay,
} from '@dayplanner/core';
import { useStatus } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Clock } from './clock.ts';
import { anytimeDrop, dayDrop, DragProvider, type DragSource, type DropTarget } from './drag.tsx';
import { DayEvents, DayTabs, EventMenu, NowAndNext, type EventActions } from './Events.tsx';
import { AddField, Pill, label, type ItemActions } from './Items.tsx';
import { RepeatSection } from './Repeat.tsx';
import { runCommand, useStoreState } from './store/adapter.ts';

/** Local calendar math for labels only: dates are plain strings, so go through UTC to avoid timezone shifts. */
const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function App({ clock, db }: { clock: Clock; db: AbstractPowerSyncDatabase }) {
  const state = useStoreState();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => clock.subscribe(() => setNow(clock.now())), [clock]);
  // the midnight jobs: on first start (after a midnight missed while closed) and at every local midnight
  useEffect(() => clock.onNewDay(() => void runCommand(db, { type: 'runMidnight' }, clock.now())), [clock, db]);
  const [dismissed, setDismissed] = useState(() => readDismissed());

  const todayDate = today(now);
  // the day opened from the strip; Today until one is tapped (a day that has passed falls back to Today)
  const [opened, setOpened] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const date = opened && opened > todayDate ? opened : todayDate;
  const view = useMemo(() => (state ? dayView(state, date, now, picked) : null), [state, date, now, picked]);
  // Occurrences are real rows: make the ones for the days on screen (the strip and the day opened) that do not exist yet.
  const shownDays = (view?.strip ?? []).map((d) => d.date).concat(date).join();
  const series = state?.series;
  useEffect(() => {
    if (!series) return;
    void runCommand(db, { type: 'materialise', dates: shownDays.split(',') }, clock.now());
  }, [db, clock, series, shownDays]);
  const dayLabel = (d: string) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });

  const [eventMenuId, setEventMenuId] = useState<string | null>(null);
  const menuEvent = state?.events.find((e) => e.id === eventMenuId) ?? null;
  const menuSeries = menuEvent?.series_id ? state?.series.find((s) => s.id === menuEvent.series_id) : undefined;
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuItem = state && menuId ? taskItem(state, menuId, now) : undefined;
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
        } else if (target.kind === 'someday') {
          await run({ type: 'undateTask', id: source.id });
          setToast(`Sent “${source.label}” to Someday`);
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
            {view.overnight.carried.length + view.overnight.skipped.length > 0 && dismissed !== todayDate && (
              <OvernightBanner
                overnight={view.overnight}
                onDismiss={() => {
                  setDismissed(todayDate);
                  writeDismissed(todayDate);
                }}
              />
            )}
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
            {menuItem && (
              <TaskMenu
                item={menuItem}
                canSend={canUndate(state!, menuItem.id)}
                canAddSub={canAddSubtask(state!, menuItem.parentId ?? menuItem.id)}
                canRepeat={canRepeat(state!, menuItem.id)}
                canDoParentToday={!!menuItem.parentId && canDateTask(state!, menuItem.parentId, todayDate)}
                today={todayDate}
                onClose={() => setMenuId(null)}
                run={run}
              />
            )}
            {view.isToday && (
              <DayTabs
                view={view}
                actions={actions}
                onAdd={(title, start, end) => run({ type: 'addEvent', id: crypto.randomUUID(), title, date, start, end })}
                onAddSomeday={(title) => run({ type: 'addTask', id: crypto.randomUUID(), title, date: null })}
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
            recurrence={menuSeries ? recurrenceLabel(menuSeries) : null}
            canRepeat={canRepeat(state!, menuEvent.id)}
            onRepeat={(recurrence) => run({ type: 'setRecurrence', id: menuEvent.id, seriesId: crypto.randomUUID(), recurrence })}
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
    case 'someday':
      return canUndate(state, source.id);
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

/** The banner is dismissed per device, for the day it was about. Browser storage may be unavailable. */
const DISMISSED_KEY = 'overnight-dismissed';
const readDismissed = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};
const writeDismissed = (date: string) => {
  try {
    localStorage.setItem(DISMISSED_KEY, date);
  } catch {
    /* the banner just comes back on reload */
  }
};

const BANNER_SHOWN = 5;

/** "Overnight: carried over A, B (Placements cleared) · skipped C". It may be long, so it collapses. */
function OvernightBanner({ overnight, onDismiss }: { overnight: DayView['overnight']; onDismiss: () => void }) {
  const [all, setAll] = useState(false);
  const names = (items: ItemView[]) => items.map(label);
  const entries = [...names(overnight.carried).map((n) => ({ n, kind: 'carried' })), ...names(overnight.skipped).map((n) => ({ n, kind: 'skipped' }))];
  const shown = all ? entries : entries.slice(0, BANNER_SHOWN);
  const part = (kind: string) => shown.filter((e) => e.kind === kind).map((e) => e.n).join(', ');
  const more = entries.length - BANNER_SHOWN;
  return (
    <section className="banner" aria-label="Overnight">
      <p>
        <strong>Overnight:</strong>
        {part('carried') && (
          <>
            {' '}
            carried over <b>{part('carried')}</b> (Placements cleared)
          </>
        )}
        {part('skipped') && (
          <>
            {part('carried') && ' · '} skipped <b>{part('skipped')}</b>
          </>
        )}{' '}
        {more > 0 && (
          <button type="button" className="linklike" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `+${more} more`}
          </button>
        )}
      </p>
      <button type="button" className="dismiss" aria-label="Dismiss overnight banner" onClick={onDismiss}>
        ✕
      </button>
    </section>
  );
}

const ANYTIME_SHOWN = 6;
const DONE_SHOWN = 4;

/** Pills that collapse to `limit` with a "+N more" / "Show less" button. */
function Collapsible({ items, limit, ...actions }: { items: ItemView[]; limit: number; fullTag?: boolean } & ItemActions) {
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
      <Collapsible items={view.anytime.items} limit={ANYTIME_SHOWN} fullTag={!view.isToday} {...actions} />
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
      <Collapsible items={items} limit={DONE_SHOWN} fullTag={!view.isToday} {...actions} />
    </section>
  );
}

/** Tap menu (bottom sheet): rename, edit the Completion time of a done item, delete. */
function TaskMenu({
  item,
  canSend,
  canAddSub,
  canDoParentToday,
  canRepeat: repeatable,
  today,
  onClose,
  run,
}: {
  item: ItemView;
  /** The core says this Task can be sent to Someday. */
  canSend: boolean;
  /** The core says a Sub-task can be added: to this Task, or for a Sub-task to its parent (never nested). */
  canAddSub: boolean;
  /** For a Sub-task: the core says its parent can be dated to today. */
  canDoParentToday: boolean;
  /** The core says "Repeat…" is offered for this Task. */
  canRepeat: boolean;
  today: string;
  onClose: () => void;
  run: (c: Command) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(item.title);
  const [time, setTime] = useState(item.completedTime ?? '');
  const [added, setAdded] = useState<string[]>([]);
  const parentId = item.parentId ?? item.id;
  const addSub = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const input = e.currentTarget;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await run({ type: 'addSubtask', id: crypto.randomUUID(), parentId, title: text });
    setAdded((a) => [...a, text]);
  };
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
  const sendToSomeday = async () => {
    await run({ type: 'undateTask', id: item.id });
    onClose();
  };
  const doToday = async () => {
    await run({ type: 'dateTask', id: item.id, date: today });
    onClose();
  };
  const runAndClose = async (command: Command) => {
    await run(command);
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
        {item.subtasks && (
          <p className="mute">
            {item.subtasks.done} of {item.subtasks.total} Sub-tasks done
          </p>
        )}
        {item.parentTitle && <p className="mute">Sub-task of “{item.parentTitle}”</p>}
        {added.length > 0 && <p className="mute">Added: {added.join(', ')}</p>}
        {canAddSub && (
          <input
            className="add"
            placeholder={item.parentTitle ? `+ Sub-task of ${item.parentTitle}` : '+ Sub-task'}
            aria-label={item.parentTitle ? `+ Sub-task of ${item.parentTitle}` : '+ Sub-task'}
            onKeyDown={addSub}
          />
        )}
        <RepeatSection recurrence={item.recurrence} canRepeat={repeatable} onRepeat={(recurrence) => runAndClose({ type: 'setRecurrence', id: item.id, seriesId: crypto.randomUUID(), recurrence })} />
        <div className="actions">
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={onClose}>Cancel</button>
          {item.placement && (
            <button type="button" onClick={takeOut}>
              Take out of {item.placement.title}
            </button>
          )}
          {item.someday && (
            <button type="button" onClick={doToday}>
              Do today
            </button>
          )}
          {canSend && (
            <button type="button" onClick={sendToSomeday}>
              Send to Someday
            </button>
          )}
          {item.parentId && !item.completedTime && (
            <button type="button" onClick={() => runAndClose({ type: 'tickTask', id: item.parentId! })}>
              Tick all of “{item.parentTitle}”
            </button>
          )}
          {canDoParentToday && (
            <button type="button" onClick={() => runAndClose({ type: 'dateTask', id: item.parentId!, date: today })}>
              Do “{item.parentTitle}” today
            </button>
          )}
          <button type="button" className="danger" onClick={remove}>Delete</button>
        </div>
      </form>
    </div>
  );
}
