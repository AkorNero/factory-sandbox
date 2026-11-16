import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

/** Run a command and return the new state. */
const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));

describe('adding a Task from inside an Event card', () => {
  it('places it in that Event: it shows in the card and not in Anytime today', () => {
    const state = aState({ events: [anEvent({ id: 'e', title: 'Deep work', start_time: '09:00', end_time: '11:00' })] });

    const after = run(state, { type: 'addTask', id: 't', title: 'Write intro', date: TODAY, eventId: 'e' });

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.now.cards[0]?.tasks.map((t) => t.title)).toEqual(['Write intro']);
    expect(view.anytime.items).toEqual([]);
    expect(after.tasks[0]).toMatchObject({ event_id: 'e', date: TODAY });
  });

  it("takes the Event's day, whatever day was asked for", () => {
    const state = aState({ events: [anEvent({ id: 'e', date: '2026-11-18' })] });

    const after = run(state, { type: 'addTask', id: 't', title: 'Plan', date: TODAY, eventId: 'e' });

    expect(after.tasks[0]?.date).toBe('2026-11-18');
  });

  it('adds nothing when the Event does not exist', () => {
    expect(apply(aState(), { type: 'addTask', id: 't', title: 'Plan', date: TODAY, eventId: 'nope' }, MON_10_15).inserts).toEqual([]);
  });
});
