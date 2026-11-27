import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { TODAY, aState, aTask, anEvent } from './helpers.ts';

const at = (hhmm: string) => `2026-11-16T${hhmm}:00+01:00`;
const run = (state: State, command: Command, now: string) => applyChanges(state, apply(state, command, now));

/** Tick `a` at the given time and return the chip the day shows for it. */
function chipAfterTick(state: State, hhmm: string) {
  const after = run(state, { type: 'tickTask', id: 'a' }, at(hhmm));
  return dayView(after, TODAY, at('23:00')).done.items.find((i) => i.id === 'a')!;
}

describe('the Event a Task was done in (from its Completion time)', () => {
  const work = anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '10:00' });
  const call = anEvent({ id: 'call', title: 'Call', start_time: '10:30', end_time: '12:00' });

  it('is the placed Event when it covers the Completion time: ticked at 09:40 reads 09:40 · Deep work', () => {
    const chip = chipAfterTick(aState({ events: [work], tasks: [aTask({ id: 'a', event_id: 'work' })] }), '09:40');

    expect([chip.completedTime, chip.doneIn]).toEqual(['09:40', 'Deep work']);
  });

  it('is the most recently started Event covering the time when the placed one does not: ticked at 11:00 names the 10:30 Event', () => {
    const state = aState({
      events: [work, call, anEvent({ id: 'long', title: 'Long block', start_time: '08:00', end_time: '13:00' })],
      tasks: [aTask({ id: 'a', event_id: 'work' })],
    });

    expect(chipAfterTick(state, '11:00').doneIn).toBe('Call');
  });

  it('is the most recently started Event when the Task was not placed at all', () => {
    const state = aState({ events: [work, call], tasks: [aTask({ id: 'a' })] });

    expect(chipAfterTick(state, '09:05').doneIn).toBe('Deep work');
  });

  it('is none when ticked outside every Event: the chip shows only the time', () => {
    const state = aState({ events: [work, call], tasks: [aTask({ id: 'a', event_id: 'work' })] });

    const chip = chipAfterTick(state, '10:10');

    expect([chip.completedTime, chip.doneIn]).toEqual(['10:10', null]);
  });

  it('counts an Event from its start minute until just before its end minute', () => {
    const state = aState({ events: [work], tasks: [aTask({ id: 'a' })] });

    expect(chipAfterTick(state, '09:00').doneIn).toBe('Deep work');
    expect(chipAfterTick(state, '09:59').doneIn).toBe('Deep work');
    expect(chipAfterTick(state, '10:00').doneIn).toBeNull();
  });

  it("only looks at Events on the Completion time's own day", () => {
    const tomorrowsWork = anEvent({ id: 'w2', title: 'Tomorrow work', date: '2026-11-17', start_time: '09:00', end_time: '10:00' });
    const state = aState({ events: [tomorrowsWork], tasks: [aTask({ id: 'a' })] });

    expect(chipAfterTick(state, '09:30').doneIn).toBeNull();
  });

  it('follows an edited Completion time, because it is worked out, not stored', () => {
    let state = aState({ events: [work, call], tasks: [aTask({ id: 'a', event_id: 'work' })] });
    state = run(state, { type: 'tickTask', id: 'a' }, at('11:00'));
    expect(dayView(state, TODAY, at('23:00')).done.items[0]?.doneIn).toBe('Call');

    state = run(state, { type: 'setCompletionTime', id: 'a', time: '09:20' }, at('11:05'));

    expect(dayView(state, TODAY, at('23:00')).done.items[0]?.doneIn).toBe('Deep work');
  });

  it('stays in the Event card as a done item, and is not in Anytime today', () => {
    const state = aState({ events: [work], tasks: [aTask({ id: 'a', title: 'Draft', event_id: 'work' })] });
    const after = run(state, { type: 'tickTask', id: 'a' }, at('09:40'));

    const view = dayView(after, TODAY, at('09:45'));

    expect(view.now.cards[0]?.tasks.map((t) => [t.title, t.completedTime])).toEqual([['Draft', '09:40']]);
    expect(view.anytime.items).toEqual([]);
  });
});
