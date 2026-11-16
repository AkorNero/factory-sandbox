import { dayView, today, type DayView, type ItemView, type StripDay } from '@dayplanner/core';
import { useStatus } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Clock } from './clock.ts';
import { DayTabs, EventMenu, NowAndNext } from './Events.tsx';
import { runCommand, useStoreState } from './store/adapter.ts';

/** Local calendar math for labels only: dates are plain strings, so go through UTC to avoid timezone shifts. */
const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function App({ clock, db }: { clock: Clock; db: AbstractPowerSyncDatabase }) {
  const state = useStoreState();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => clock.subscribe(() => setNow(clock.now())), [clock]);

  const [menuId, setMenuId] = useState<string | null>(null);
  const date = today(now);
  const view = useMemo(() => (state ? dayView(state, date, now) : null), [state, date, now]);

  const menuEvent = state?.events.find((e) => e.id === menuId) ?? null;

  return (
    <main className="main">
      <header className="top">
        <h1>{fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        <SyncBadge />
      </header>
      {view && (
        <>
          <Strip days={view.strip} selected={view.date} />
          <NowAndNext view={view} open={setMenuId} />
          <Anytime view={view} onAdd={(title) => runCommand(db, { type: 'addTask', id: crypto.randomUUID(), title, date }, clock.now())} />
          <DoneToday view={view} />
          <DayTabs
            view={view}
            open={setMenuId}
            onAdd={(title, start, end) => runCommand(db, { type: 'addEvent', id: crypto.randomUUID(), title, date, start, end }, clock.now())}
          />
        </>
      )}
      {menuEvent && (
        <EventMenu
          key={menuEvent.id}
          event={menuEvent}
          onClose={() => setMenuId(null)}
          onSave={async (title, start, end) => {
            await runCommand(db, { type: 'renameEvent', id: menuEvent.id, title }, clock.now());
            await runCommand(db, { type: 'setEventTimes', id: menuEvent.id, start, end }, clock.now());
          }}
          onDelete={() => runCommand(db, { type: 'deleteEvent', id: menuEvent.id }, clock.now())}
        />
      )}
    </main>
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

function Strip({ days, selected }: { days: StripDay[]; selected: string }) {
  return (
    <nav className="strip" aria-label="Upcoming">
      {days.map((d, i) => (
        <div key={d.date} className={`chip ${d.date === selected ? 'sel' : ''}`}>
          <span className="wd">{i === 0 ? 'Today' : fmt(d.date, { weekday: 'short' })}</span>
          <span className="dn">{fmt(d.date, { day: 'numeric' })}</span>
          <span className="dots" aria-label={`${d.events} events, ${d.tasks} tasks`}>
            {'▪'.repeat(Math.min(d.events, 4))}
            {'•'.repeat(Math.min(d.tasks, 4))}
          </span>
        </div>
      ))}
    </nav>
  );
}

const COLLAPSED = 6;

function Anytime({ view, onAdd }: { view: DayView; onAdd: (title: string) => Promise<unknown> }) {
  const [all, setAll] = useState(false);
  const shown = all ? view.anytime.items : view.anytime.items.slice(0, COLLAPSED);
  const more = view.anytime.items.length - COLLAPSED;
  return (
    <section aria-labelledby="anytime-h">
      <h2 id="anytime-h" className="sec">
        Anytime today <span className="count" data-testid="anytime-count">{view.anytime.count}</span>
      </h2>
      <ul className="pills">
        {shown.map((i) => (
          <li key={i.id} className={`pill ${i.carriedOver ? 'carried' : ''}`}>
            <span className="tick" />
            <span>{label(i)}</span>
            {i.carriedOver && <span className="badge warn">↪</span>}
            {i.recurring && <span className="badge">↻</span>}
          </li>
        ))}
        {more > 0 && (
          <li>
            <button type="button" className="pill dashed more" onClick={() => setAll(!all)}>
              {all ? 'Show less' : `+${more} more`}
            </button>
          </li>
        )}
      </ul>
      <AddField placeholder="+ Task today" onAdd={onAdd} />
    </section>
  );
}

const label = (i: ItemView) => (i.parentTitle ? `${i.parentTitle} › ${i.title}` : i.title);

function AddField({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    setText(''); // keeps focus for the next one
    await onAdd(title);
  };
  return (
    <form onSubmit={submit}>
      <input className="add" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function DoneToday({ view }: { view: DayView }) {
  const { count, total, items } = view.done;
  if (total === 0) return null;
  return (
    <section aria-labelledby="done-h">
      <h2 id="done-h" className="sec">
        Done today <span className="count">{count}</span>
      </h2>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
        <div style={{ width: `${(count / total) * 100}%` }} />
      </div>
      <p className="mute">
        {count} of {total} done
      </p>
      <ul className="pills">
        {items.map((i) => (
          <li key={i.id} className="pill done">
            <span className="tick on">✓</span>
            <span>{label(i)}</span>
            {i.completedTime && <small className="mute">{i.completedTime}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
