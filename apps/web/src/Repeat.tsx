import type { RecurrenceRule } from '@dayplanner/core';
import { useState } from 'react';

/** The small picker behind "Repeat…" (spec assumption A5): one of the three rules. It only gathers input; the core validates. */

type Kind = 'days' | 'weekdays' | 'month';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function RepeatPicker({ onApply }: { onApply: (rule: RecurrenceRule) => void }) {
  const [kind, setKind] = useState<Kind>('days');
  const [days, setDays] = useState('1');
  const [picked, setPicked] = useState<number[]>([]);
  const [weeks, setWeeks] = useState('1');
  const [dom, setDom] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const n = Number(kind === 'days' ? days : kind === 'weekdays' ? weeks : dom);
    if (kind === 'weekdays' && picked.length === 0) return setError('Pick at least one weekday.');
    if (!Number.isInteger(n) || n < 1 || (kind === 'month' && n > 31)) {
      return setError(kind === 'month' ? 'Pick a day from 1 to 31.' : 'Use a whole number from 1.');
    }
    setError(null);
    onApply(
      kind === 'days'
        ? { rule: 'every_n_days', interval: n }
        : kind === 'weekdays'
          ? { rule: 'weekdays', weekdays: picked, everyWeeks: n }
          : { rule: 'day_of_month', day: n },
    );
  };

  return (
    <fieldset className="repeat">
      <legend>Repeat</legend>
      <label>
        Repeats
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Repeat rule">
          <option value="days">Every N days</option>
          <option value="weekdays">On chosen weekdays</option>
          <option value="month">On a day of the month</option>
        </select>
      </label>
      {kind === 'days' && (
        <label>
          Every (days)
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      )}
      {kind === 'weekdays' && (
        <>
          <div className="weekdays" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`chip-day ${picked.includes(i + 1) ? 'on' : ''}`}
                aria-pressed={picked.includes(i + 1)}
                onClick={() => setPicked((p) => (p.includes(i + 1) ? p.filter((d) => d !== i + 1) : [...p, i + 1]))}
              >
                {name}
              </button>
            ))}
          </div>
          <label>
            Every (weeks)
            <input type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
          </label>
        </>
      )}
      {kind === 'month' && (
        <label>
          Day of the month
          <input type="number" min={1} max={31} value={dom} onChange={(e) => setDom(e.target.value)} />
          <small>31 means the last day of shorter months.</small>
        </label>
      )}
      {error && (
        <p className="msg error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="primary" onClick={apply}>
        Start repeating
      </button>
    </fieldset>
  );
}

/**
 * The "Repeat…" part of a tap menu. An item that already repeats says so; changing or stopping its schedule
 * ("Change schedule", "Stop repeating", spec A5) comes with editing Occurrences, not here.
 */
export function RepeatSection({
  recurrence,
  canRepeat,
  onRepeat,
}: {
  recurrence: string | null;
  canRepeat: boolean;
  onRepeat: (rule: RecurrenceRule) => void;
}) {
  const [open, setOpen] = useState(false);
  if (recurrence !== null) return <p className="mute">↻ Repeats {recurrence}</p>;
  if (!canRepeat) return null;
  return open ? (
    <RepeatPicker onApply={onRepeat} />
  ) : (
    <button type="button" className="repeat-open" onClick={() => setOpen(true)}>
      Repeat…
    </button>
  );
}
