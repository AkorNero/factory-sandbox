import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type State } from '../src/index.ts';
import { aState, aTask, anEvent } from './helpers.ts';

const TUE_00_00 = '2026-11-17T00:00:00+01:00';
const MON = '2026-11-16';

const midnight = (state: State, now = TUE_00_00) => applyChanges(state, apply(state, { type: 'runMidnight' }, now));

describe('the overnight banner', () => {
  it('lists what was carried over, Sub-tasks as "Parent › Sub-task", once each', () => {
    const state = aState({
      events: [anEvent({ id: 'e', date: MON })],
      tasks: [
        aTask({ id: 'a', title: 'Write report', date: '2026-11-14', event_id: 'e', position: 1 }),
        aTask({ id: 'p', title: 'Taxes', date: MON, position: 2 }),
        aTask({ id: 's', parent_id: 'p', title: 'Collect receipts', date: null, position: 3 }),
        aTask({ id: 'c', title: 'Buy stamps', date: MON, position: 4 }),
      ],
    });

    const { overnight } = dayView(midnight(state), '2026-11-17', TUE_00_00);

    expect(overnight.carried.map((i) => [i.title, i.parentTitle])).toEqual([
      ['Write report', null],
      ['Collect receipts', 'Taxes'],
      ['Buy stamps', null],
    ]);
  });

  it('is empty when nothing moved', () => {
    const state = aState({ tasks: [aTask({ id: 'a', date: '2026-11-17' })] });

    expect(dayView(midnight(state), '2026-11-17', TUE_00_00).overnight).toEqual({ carried: [], skipped: [] });
  });

  it('does not list what an earlier night carried and the user has since re-dated', () => {
    const carriedMonday = midnight(aState({ tasks: [aTask({ id: 'a', title: 'Old', date: '2026-11-15' })] }), '2026-11-16T00:00:00+01:00');
    const redated = applyChanges(carriedMonday, { inserts: [], updates: [{ table: 'tasks', id: 'a', set: { date: '2026-11-20' } }], deletes: [] });

    expect(dayView(redated, '2026-11-17', TUE_00_00).overnight.carried).toEqual([]);
  });

  it('can be long: it lists every carried item', () => {
    const tasks = Array.from({ length: 40 }, (_, i) => aTask({ id: `t${String(i).padStart(2, '0')}`, title: `Task ${i}`, date: MON, position: i }));

    expect(dayView(midnight(aState({ tasks })), '2026-11-17', TUE_00_00).overnight.carried).toHaveLength(40);
  });

  it('shows the same banner whichever day is open, because it is about tonight', () => {
    const state = midnight(aState({ tasks: [aTask({ id: 'a', date: MON })] }));

    expect(dayView(state, '2026-11-19', TUE_00_00).overnight.carried).toHaveLength(1);
  });

  it('lists what was closed as Skipped during the night', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'k', title: 'Water plants', date: MON, skipped_at: '2026-11-17T00:00:00+01:00' }),
        aTask({ id: 'old', title: 'Old', date: MON, skipped_at: '2026-11-16T00:00:00+01:00' }),
      ],
    });

    expect(dayView(state, '2026-11-17', TUE_00_00).overnight.skipped.map((i) => i.title)).toEqual(['Water plants']);
  });
});
