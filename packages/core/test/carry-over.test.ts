import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { aState, aTask, anEvent } from './helpers.ts';

// Tuesday 17 November 2026, just after midnight: the job runs for the day that has just begun.
const TUE_00_00 = '2026-11-17T00:00:00+01:00';
const MON = '2026-11-16';
const TUE = '2026-11-17';

const midnight = (state: State, now = TUE_00_00) => applyChanges(state, apply(state, { type: 'runMidnight' } satisfies Command, now));
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id)!;

describe("Carry-over at midnight: a Task placed in yesterday's Event", () => {
  const base = () =>
    aState({
      events: [anEvent({ id: 'dw', title: 'Deep work', date: MON, start_time: '09:00', end_time: '11:00' })],
      tasks: [
        aTask({ id: 'a', title: 'Write report', date: MON, event_id: 'dw', position: 1 }),
        aTask({ id: 'b', title: 'Buy stamps', date: TUE, position: 2 }),
      ],
    });

  it('moves to today, loses its Placement and is marked as carried over', () => {
    expect(task(midnight(base()), 'a')).toMatchObject({ date: TUE, event_id: null, carried_over: true });
  });

  it('is first in Anytime today, with the carried-over mark', () => {
    const view = dayView(midnight(base()), TUE, TUE_00_00);

    expect(view.anytime.items.map((i) => [i.title, i.carriedOver])).toEqual([
      ['Write report', true],
      ['Buy stamps', false],
    ]);
  });

  it("leaves yesterday's Event showing a missed slot", () => {
    const [card] = dayView(midnight(base()), MON, TUE_00_00).earlier.events;

    expect(card).toMatchObject({ title: 'Deep work', slotMissed: true, placedDone: 0, placedTotal: 1 });
    expect(card?.tasks.map((t) => t.title)).toEqual(['Write report']);
  });
});
