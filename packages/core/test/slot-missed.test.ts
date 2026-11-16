import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView } from '../src/index.ts';
import { TODAY, aState, aTask, anEvent } from './helpers.ts';

const at = (hhmm: string) => `2026-11-16T${hhmm}:00+01:00`;
const morning = anEvent({ id: 'm', title: 'Admin', start_time: '08:00', end_time: '09:00' });
const placed = (id: string, title: string, over = {}) => aTask({ id, title, event_id: 'm', ...over });

describe('an Event whose slot ended', () => {
  it('with 1 of 3 placed Tasks done shows "1/3 done" and is a missed slot; the unfinished Tasks stay in it', () => {
    const state = aState({
      events: [morning],
      tasks: [
        placed('a', 'Invoices', { completed_at: at('08:30') }),
        placed('b', 'Emails', { position: 2 }),
        placed('c', 'Filing', { position: 3 }),
      ],
    });

    const [card] = dayView(state, TODAY, at('10:15')).earlier.events;

    expect(card).toMatchObject({ placedDone: 1, placedTotal: 3, slotMissed: true });
    expect(card?.tasks.map((t) => t.title)).toEqual(['Invoices', 'Emails', 'Filing']);
  });

  it('with every placed Task done is not a missed slot', () => {
    const state = aState({
      events: [morning],
      tasks: [placed('a', 'Invoices', { completed_at: at('08:30') }), placed('b', 'Emails', { completed_at: at('08:40') })],
    });

    expect(dayView(state, TODAY, at('10:15')).earlier.events[0]).toMatchObject({ placedDone: 2, placedTotal: 2, slotMissed: false });
  });

  it('with nothing placed is not a missed slot', () => {
    const state = aState({ events: [morning] });

    expect(dayView(state, TODAY, at('10:15')).earlier.events[0]).toMatchObject({ placedDone: 0, placedTotal: 0, slotMissed: false });
  });

  it('lists the items done in it, which are not always the ones placed in it', () => {
    const state = aState({
      events: [morning],
      tasks: [aTask({ id: 'x', title: 'Unplanned', completed_at: at('08:10') }), placed('b', 'Emails')],
    });

    expect(dayView(state, TODAY, at('10:15')).earlier.events[0]?.doneHere.map((t) => t.title)).toEqual(['Unplanned']);
  });

  it('only counts as missed once the slot has ended', () => {
    const state = aState({ events: [morning], tasks: [placed('a', 'Emails')] });

    expect(dayView(state, TODAY, at('08:30')).now.cards[0]).toMatchObject({ placedDone: 0, placedTotal: 1 });
    expect(dayView(state, TODAY, at('09:00')).earlier.events[0]?.slotMissed).toBe(true);
  });

  it('is a missed slot on a past day too', () => {
    const state = aState({
      events: [anEvent({ id: 'y', title: 'Yesterday', date: '2026-11-15' })],
      tasks: [aTask({ id: 'a', date: '2026-11-15', event_id: 'y' })],
    });

    expect(dayView(state, '2026-11-15', at('10:15')).earlier.events[0]?.slotMissed).toBe(true);
  });
});

describe('deleting an Event', () => {
  it('leaves its Tasks unplaced on that day, in Anytime, not deleted', () => {
    const state = aState({
      events: [morning, anEvent({ id: 'other', title: 'Other', start_time: '18:00', end_time: '19:00' })],
      tasks: [placed('a', 'Invoices'), placed('b', 'Emails'), aTask({ id: 'c', title: 'Elsewhere', event_id: 'other' })],
    });

    const changes = apply(state, { type: 'deleteEvent', id: 'm' }, at('10:15'));
    const after = applyChanges(state, changes);

    expect(changes.deletes).toEqual([{ table: 'events', id: 'm' }]);
    expect(after.tasks.map((t) => [t.id, t.event_id, t.date])).toEqual([
      ['a', null, TODAY],
      ['b', null, TODAY],
      ['c', 'other', TODAY],
    ]);
    expect(dayView(after, TODAY, at('10:15')).anytime.items.map((t) => t.title)).toEqual(['Invoices', 'Emails']);
  });

  it('writes only the Placement and updated-at on each Task', () => {
    const state = aState({ events: [morning], tasks: [placed('a', 'Invoices')] });

    expect(apply(state, { type: 'deleteEvent', id: 'm' }, at('10:15')).updates).toEqual([
      { table: 'tasks', id: 'a', set: { event_id: null, updated_at: at('10:15') } },
    ]);
  });

  it('keeps a Task on the Event\'s day if its own date had drifted', () => {
    const state = aState({ events: [morning], tasks: [aTask({ id: 'a', date: null, event_id: 'm' })] });

    const after = applyChanges(state, apply(state, { type: 'deleteEvent', id: 'm' }, at('10:15')));

    expect(after.tasks[0]).toMatchObject({ event_id: null, date: TODAY });
  });

  it("leaves a Sub-task's day to its parent", () => {
    const state = aState({
      events: [morning],
      tasks: [aTask({ id: 'p', title: 'Project', date: '2026-11-18' }), aTask({ id: 's', title: 'Step', parent_id: 'p', date: null, event_id: 'm' })],
    });

    const after = applyChanges(state, apply(state, { type: 'deleteEvent', id: 'm' }, at('10:15')));

    expect(after.tasks.find((t) => t.id === 's')).toMatchObject({ event_id: null, date: null });
    expect(dayView(after, '2026-11-18', at('10:15')).anytime.items.map((t) => t.title)).toContain('Step');
  });
});
