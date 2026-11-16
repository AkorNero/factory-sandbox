import {
  checkEventTimes,
  formatDuration,
  parseEventInput,
  type DayView,
  type EventCard,
  type NowCard,
  type RecurrenceRule,
  type Scope,
} from '@dayplanner/core';
import { useState, type FormEvent, type ReactNode } from 'react';
import { eventDrop, somedayDrop, useDrag } from './drag.tsx';
import { AddField, Recurrence, TaskRows, type ItemActions } from './Items.tsx';
import { RepeatSection } from './Repeat.tsx';
import { ScopePrompt, useScopeAsk } from './Scope.tsx';
import './events.css';

/** The Events part of a day: Now and Next (today only), and the Later / Earlier / Someday tabs (every day). No rules in here. */

export type Open = (eventId: string) => void;

/** What the Event cards need from the screen: the tap menus, ticking, and adding a Task straight into an Event. */
export interface EventActions extends ItemActions {
  open: Open;
  onAddTask: (eventId: string, title: string) => Promise<unknown>;
}

/** The "+ …" field inside an Event card. */
function AddInEvent({ card, actions }: { card: { id: string; title: string }; actions: EventActions }) {
  return <AddField placeholder={`+ Task in ${card.title}`} onAdd={(title) => actions.onAddTask(card.id, title)} />;
}

const range = (e: { start: string; end: string }) => `${e.start}–${e.end}`;

/** The Event's title, opening its menu; a recurring Event carries ↻ (in full, "↻ daily", where `fullTag` is set). */
function EventButton({
  card,
  open,
  className,
  fullTag,
}: {
  card: { id: string; title: string; recurrence: string | null };
  open: Open;
  className?: string;
  fullTag?: boolean;
}) {
  return (
    <button type="button" className={`ev-title ${className ?? ''}`} onClick={() => open(card.id)}>
      {card.title}
      {card.recurrence !== null && ' '}
      <Recurrence recurrence={card.recurrence} full={fullTag} />
    </button>
  );
}

export function NowAndNext({ view, actions }: { view: DayView; actions: EventActions }) {
  const { open } = actions;
  const drag = useDrag();
  const { cards } = view.now;
  const [lead, ...others] = cards;
  return (
    <>
      <section data-testid="now" aria-label="Now">
        {cards.length > 1 && <h2 className="sec">{cards.length} Events at once</h2>}
        {!lead ? (
          <div className="card free">
            <div className="ev-label">Now</div>
            <div className="big">Free</div>
            <p className="mute">No Event right now.</p>
          </div>
        ) : (
          <div className="now-grid">
            <NowCardView card={lead} actions={actions} lead={cards.length === 1 ? 'only' : 'lead'} />
            {others.map((c) => (
              <NowCardView key={c.id} card={c} actions={actions} lead="also" />
            ))}
          </div>
        )}
      </section>
      {view.next && (
        <section data-testid="next" aria-label="Next" className="card next">
          <div className="ev-label">
            Next · {view.next.start} (in {formatDuration(view.next.startsInMinutes)})
          </div>
          {view.next.events.map((e) => (
            <div key={e.id} className="next-ev" {...eventDrop(e.id)} {...drag.dragProps({ kind: 'event', id: e.id, label: e.title })}>
              <EventButton card={e} open={open} className="h3" />
              <span className="mute"> {range(e)}</span>
              <TaskRows items={e.tasks} {...actions} />
              <AddInEvent card={e} actions={actions} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function NowCardView({ card, actions, lead }: { card: NowCard; actions: EventActions; lead: 'only' | 'lead' | 'also' }) {
  const { open } = actions;
  const percent = Math.round(card.progress * 100);
  const drag = useDrag().dragProps({ kind: 'event', id: card.id, label: card.title });
  return (
    <div className={`now-card ${lead === 'also' ? 'also' : ''}`} data-testid="now-card" {...eventDrop(card.id)} {...drag}>
      <div className="ev-label">
        {lead === 'also' ? 'Also now' : 'Now'} · {range(card)} · {card.minutesLeft} min left
      </div>
      <EventButton card={card} open={open} className="big" />
      <div className="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
      {card.tasks.length === 0 && <p className="nothing">Nothing placed</p>}
      <TaskRows items={card.tasks} {...actions} />
      <AddInEvent card={card} actions={actions} />
    </div>
  );
}

type Tab = 'later' | 'earlier' | 'someday';

export function DayTabs({
  view,
  actions,
  onAdd,
  onAddSomeday,
}: {
  view: DayView;
  actions: EventActions;
  onAdd: (title: string, start: string, end: string) => Promise<unknown>;
  onAddSomeday: (title: string) => Promise<unknown>;
}) {
  const { open } = actions;
  const [tab, setTab] = useState<Tab>('later');
  const tabs: [Tab, string, number][] = [
    ['later', view.isToday ? 'Later today' : 'Events', view.later.count],
    ['earlier', view.isToday ? 'Earlier today' : 'Earlier', view.earlier.count],
    ['someday', 'Someday', view.someday.count],
  ];
  return (
    <section aria-label="The rest of the day">
      <div className="seg" role="tablist">
        {tabs.map(([id, name, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${tab === id ? 'on' : ''} ${id === 'someday' ? 'someday' : ''}`}
            onClick={() => setTab(id)}
            {...(id === 'someday' ? somedayDrop : {})}
          >
            {name} <span className="tabcount">{count}</span>
          </button>
        ))}
      </div>
      <div className={`panel ${tab === 'someday' ? 'someday' : ''}`} role="tabpanel" data-testid="tab-panel">
        {tab === 'someday' ? (
          <>
            <p className="note">Tasks with no date</p>
            <TaskRows items={view.someday.items} {...actions} />
            <AddField placeholder="+ Someday Task" onAdd={onAddSomeday} />
          </>
        ) : tab === 'later' ? (
          <>
            {view.later.events.map((e) => (
              <Row
                key={e.id}
                card={e}
                actions={actions}
                sub={range(e)}
                right={e.startsInMinutes === null ? null : <span className="rel">in {formatDuration(e.startsInMinutes)}</span>}
              />
            ))}
            {view.later.count === 0 && <p className="mute">{view.isToday ? 'Nothing else later today.' : 'No Events on this day.'}</p>}
            <AddEvent onAdd={onAdd} />
          </>
        ) : (
          <>
            {view.earlier.events.map((e) => (
              <Row
                key={e.id}
                card={e}
                actions={actions}
                past
                sub={[range(e), formatDuration(e.durationMinutes), ...e.doneHere.map((t) => t.title)].join(' · ')}
                right={<Outcome card={e} />}
              />
            ))}
            {view.earlier.count === 0 && <p className="mute">{view.isToday ? 'Nothing has finished yet.' : 'Nothing earlier on this day.'}</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** How a finished Event went: "1/3 done" in orange with "slot missed", "3/3 done" in green, or how long ago it ended. */
function Outcome({ card }: { card: EventCard }) {
  if (card.placedTotal === 0) {
    return card.endedMinutesAgo === null ? null : <span className="rel">ended {formatDuration(card.endedMinutesAgo)} ago</span>;
  }
  return (
    <span className={`rel ${card.slotMissed ? 'missed' : 'all-done'}`}>
      {card.placedDone}/{card.placedTotal} done{card.slotMissed && ' · slot missed'}
    </span>
  );
}

function Row({
  card,
  actions,
  sub,
  right,
  past,
}: {
  card: EventCard;
  actions: EventActions;
  sub: string;
  right: ReactNode;
  past?: boolean;
}) {
  const drag = useDrag().dragProps({ kind: 'event', id: card.id, label: card.title });
  return (
    <div className={`ev-row ${past ? 'past' : ''}`} {...eventDrop(card.id)} {...drag}>
      <div className="ev-head">
        <div>
          <EventButton card={card} open={actions.open} fullTag />
          <div className="mute">{sub}</div>
        </div>
        {right}
      </div>
      <TaskRows items={card.tasks} {...actions} />
      <AddInEvent card={card} actions={actions} />
    </div>
  );
}

function AddEvent({ onAdd }: { onAdd: (title: string, start: string, end: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const parsed = parseEventInput(text);
    if (!parsed.ok) return setMessage({ kind: 'error', text: parsed.error });
    setText('');
    setMessage({ kind: 'ok', text: `Added “${parsed.title}” ${parsed.start}–${parsed.end}` });
    await onAdd(parsed.title, parsed.start, parsed.end);
  };
  const placeholder = '+ Event, e.g. Gym 18-19';
  return (
    <form onSubmit={submit}>
      <input className="add" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {message && (
        <p className={`msg ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </form>
  );
}

/** The tap menu of an Event: name, times, delete. It only gathers input; the core decides. */
export function EventMenu({
  event,
  onClose,
  onSave,
  onDelete,
  recurrence,
  canRepeat,
  onRepeat,
  asksScope,
  canEditSchedule,
  onChangeSchedule,
  onStop,
}: {
  event: { id: string; title: string; start_time: string; end_time: string };
  onClose: () => void;
  /** `scope` is set when the Event is an Occurrence: the answer to "Just this one" / "This and following". */
  onSave: (title: string, start: string, end: string, scope?: Scope) => Promise<unknown>;
  onDelete: (scope?: Scope) => Promise<unknown>;
  /** The short name of its Recurrence; null for a one-off Event. */
  recurrence: string | null;
  /** The core says "Repeat…" is offered. */
  canRepeat: boolean;
  onRepeat: (rule: RecurrenceRule) => Promise<unknown>;
  /** The core says an edit of this Event must ask which Occurrences it reaches. */
  asksScope: boolean;
  /** The core says its schedule can be changed or stopped. */
  canEditSchedule: boolean;
  onChangeSchedule: (rule: RecurrenceRule) => Promise<unknown>;
  onStop: () => Promise<unknown>;
}) {
  const scope = useScopeAsk(asksScope);
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(event.start_time);
  const [end, setEnd] = useState(event.end_time);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkEventTimes(start, end) ?? (title.trim() ? null : 'Give the Event a name.');
    if (problem) return setError(problem);
    const changed = title.trim() !== event.title || start !== event.start_time || end !== event.end_time;
    if (!changed) return onClose();
    scope.ask(async (chosen) => {
      await onSave(title, start, end, chosen);
      onClose();
    });
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-label="Edit Event" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="grab" />
        <label>
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="times">
          <label>
            Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="msg error" role="alert">
            {error}
          </p>
        )}
        <RepeatSection
          recurrence={recurrence}
          canRepeat={canRepeat}
          onRepeat={async (rule) => {
            await onRepeat(rule);
            onClose();
          }}
          canEditSchedule={canEditSchedule}
          onChangeSchedule={async (rule) => {
            await onChangeSchedule(rule);
            onClose();
          }}
          onStop={async () => {
            await onStop();
            onClose();
          }}
        />
        <ScopePrompt ask={scope} />
        <div className="actions">
          <button type="submit" className="primary">
            Save
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              scope.ask(async (chosen) => {
                await onDelete(chosen);
                onClose();
              })
            }
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
