import { describe, expect, it } from 'vitest';
import { canPickDay, dayView } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

describe('picked days on the strip', () => {
  const state = aState({
    events: [anEvent({ id: 'e1', date: '2026-11-25' })],
    tasks: [
      aTask({ id: 'a', date: '2026-11-25' }),
      aTask({ id: 'b', date: '2026-11-25', completed_at: '2026-11-16T07:00:00+01:00' }),
      aTask({ id: 'c', date: '2026-11-25', title: 'Placed', event_id: 'e1' }),
    ],
  });

  it('joins the strip after the 7 days, with its own dot counts, in date order', () => {
    const view = dayView(state, TODAY, MON_10_15, ['2026-11-30', '2026-11-25']);

    expect(view.strip).toHaveLength(10);
    expect(view.strip.slice(8)).toEqual([
      { date: '2026-11-25', events: 1, tasks: 2 },
      { date: '2026-11-30', events: 0, tasks: 0 },
    ]);
  });

  it('is not repeated when picked twice, nor when it is already one of the 7 days', () => {
    const view = dayView(state, TODAY, MON_10_15, ['2026-11-25', '2026-11-25', '2026-11-20', TODAY]);

    expect(view.strip.map((d) => d.date)).toHaveLength(9);
    expect(view.strip.filter((d) => d.date === '2026-11-20')).toHaveLength(1);
  });

  it('only offers days after the 7 shown: from the 24th of November', () => {
    expect(canPickDay(MON_10_15, '2026-11-23')).toBe(false);
    expect(canPickDay(MON_10_15, '2026-11-24')).toBe(true);
    expect(canPickDay(MON_10_15, '2027-01-02')).toBe(true);
    expect(canPickDay(MON_10_15, '')).toBe(false);
    expect(canPickDay(MON_10_15, '2026-13-40')).toBe(false);
  });

  it('shows a later day in the same layout, with its Events and unplaced Tasks', () => {
    const view = dayView(state, '2026-11-25', MON_10_15);

    expect(view.isToday).toBe(false);
    expect(view.later.events.map((e) => e.tasks.map((t) => t.title))).toEqual([['Placed']]);
    expect(view.anytime.items.map((t) => t.id)).toEqual(['a']);
  });
});
