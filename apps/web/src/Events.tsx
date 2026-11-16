import {
  checkEventTimes,
  formatDuration,
  parseEventInput,
  type DayView,
  type EventCard,
  type NowCard,
} from '@dayplanner/core';
import { useState, type FormEvent } from 'react';
import './events.css';

/** The Events part of Today: Now, Next, and the Later today / Earlier today tabs. No rules in here. */

export type Open = (eventId: string) => void;

const range = (e: { start: string; end: string }) => `${e.start}–${e.end}`;

function EventButton({ card, open, className }: { card: { id: string; title: string }; open: Open; className?: string }) {
  return (
    <button type="button" className={`ev-title ${className ?? ''}`} onClick={() => open(card.id)}>
      {card.title}
    </button>
  );
}

export function NowAndNext({ view, open }: { view: DayView; open: Open }) {
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
            <NowCardView card={lead} open={open} lead={cards.length === 1 ? 'only' : 'lead'} />
            {others.map((c) => (
              <NowCardView key={c.id} card={c} open={open} lead="also" />
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
            <div key={e.id} className="next-ev">
              <EventButton card={e} open={open} className="h3" />
              <span className="mute"> {range(e)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function NowCardView({ card, open, lead }: { card: NowCard; open: Open; lead: 'only' | 'lead' | 'also' }) {
  const percent = Math.round(card.progress * 100);
  return (
    <div className={`now-card ${lead === 'also' ? 'also' : ''}`} data-testid="now-card">
      <div className="ev-label">
        {lead === 'also' ? 'Also now' : 'Now'} · {range(card)} · {card.minutesLeft} min left
      </div>
      <EventButton card={card} open={open} className="big" />
      <div className="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

type Tab = 'later' | 'earlier';

export function DayTabs({
  view,
  open,
  onAdd,
}: {
  view: DayView;
  open: Open;
  onAdd: (title: string, start: string, end: string) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<Tab>('later');
  const tabs: [Tab, string, number][] = [
    ['later', 'Later today', view.later.count],
    ['earlier', 'Earlier today', view.earlier.count],
  ];
  return (
    <section aria-label="The rest of the day">
      <div className="seg" role="tablist">
        {tabs.map(([id, name, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {name} <span className="tabcount">{count}</span>
          </button>
        ))}
      </div>
      <div className="panel" role="tabpanel" data-testid="tab-panel">
        {tab === 'later' ? (
          <>
            {view.later.events.map((e) => (
              <Row key={e.id} card={e} open={open} sub={range(e)} right={e.startsInMinutes === null ? null : `in ${formatDuration(e.startsInMinutes)}`} />
            ))}
            {view.later.count === 0 && <p className="mute">Nothing else later today.</p>}
            <AddEvent onAdd={onAdd} />
          </>
        ) : (
          <>
            {view.earlier.events.map((e) => (
              <Row
                key={e.id}
                card={e}
                open={open}
                past
                sub={`${range(e)} · ${formatDuration(e.durationMinutes)}`}
                right={e.endedMinutesAgo === null ? null : `ended ${formatDuration(e.endedMinutesAgo)} ago`}
              />
            ))}
            {view.earlier.count === 0 && <p className="mute">Nothing has finished yet.</p>}
          </>
        )}
      </div>
    </section>
  );
}

function Row({ card, open, sub, right, past }: { card: EventCard; open: Open; sub: string; right: string | null; past?: boolean }) {
  return (
    <div className={`ev-row ${past ? 'past' : ''}`}>
      <div>
        <EventButton card={card} open={open} />
        <div className="mute">{sub}</div>
      </div>
      {right && <span className="rel">{right}</span>}
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
}: {
  event: { id: string; title: string; start_time: string; end_time: string };
  onClose: () => void;
  onSave: (title: string, start: string, end: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(event.title);
  const [start, setStart] = useState(event.start_time);
  const [end, setEnd] = useState(event.end_time);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkEventTimes(start, end) ?? (title.trim() ? null : 'Give the Event a name.');
    if (problem) return setError(problem);
    await onSave(title, start, end);
    onClose();
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
            onClick={async () => {
              await onDelete();
              onClose();
            }}
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
