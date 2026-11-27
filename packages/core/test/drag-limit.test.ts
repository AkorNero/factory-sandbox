import { describe, expect, it } from 'vitest';
import { apply, applyChanges, canDateTask, canMoveEvent, canPlace, occurrenceId, type State } from '../src/index.ts';
import { MON_10_15, aSeries, aState, aTask, anEvent } from './helpers.ts';

const NOTHING = { inserts: [], updates: [], deletes: [] };

// A weekly Task on Mondays; today is Monday 16 November, so its next Occurrence is on Monday 23 November.
const weekly = aSeries({
  id: 'weekly',
  rule: 'weekdays',
  weekdays: '[1]',
  anchor_date: '2026-11-16',
  starts_on: '2026-11-16',
  template: JSON.stringify({ title: 'Clean oven', subtasks: [] }),
});
const occurrence = () => aTask({ id: 'occ', title: 'Clean oven', date: '2026-11-16', series_id: 'weekly', occurrence_date: '2026-11-16' });
const state = (extra: Partial<State> = {}) => aState({ series: [weekly], tasks: [occurrence()], ...extra });

describe('the drag limit on a Task Occurrence', () => {
  it('allows a drop on any day before its next Occurrence', () => {
    for (const day of ['2026-11-17', '2026-11-20', '2026-11-22']) expect(canDateTask(state(), 'occ', day)).toBe(true);
  });

  it("refuses a drop on the day of its next Occurrence", () => {
    expect(canDateTask(state(), 'occ', '2026-11-23')).toBe(false);
  });

  it('refuses a drop past the day of its next Occurrence, however far', () => {
    expect(canDateTask(state(), 'occ', '2026-11-24')).toBe(false);
    expect(canDateTask(state(), 'occ', '2027-03-01')).toBe(false);
  });

  it('is judged from the Occurrence\'s own day, so a carried-over one is held to the same next Occurrence', () => {
    const carried = { ...occurrence(), date: '2026-11-19', carried_over: true };

    expect(canDateTask(state({ tasks: [carried] }), 'occ', '2026-11-22')).toBe(true);
    expect(canDateTask(state({ tasks: [carried] }), 'occ', '2026-11-23')).toBe(false);
  });

  it('is judged by the schedule, not by whether the next Occurrence has been made yet or was deleted', () => {
    const deletedNext = aTask({ id: occurrenceId('weekly', '2026-11-23'), series_id: 'weekly', occurrence_date: '2026-11-23', date: '2026-11-23', deleted_at: MON_10_15 });

    expect(canDateTask(state(), 'occ', '2026-11-23')).toBe(false);
    expect(canDateTask(state({ tasks: [occurrence(), deletedNext] }), 'occ', '2026-11-23')).toBe(false);
  });

  it('does not apply the limit to a one-off Task', () => {
    expect(canDateTask(aState({ tasks: [aTask({ id: 'one' })] }), 'one', '2027-03-01')).toBe(true);
  });

  it('makes the date command do nothing for a refused drop', () => {
    expect(apply(state(), { type: 'dateTask', id: 'occ', date: '2026-11-23' }, MON_10_15)).toEqual(NOTHING);
  });

  it('also refuses a drop on an Event on or past that day (placing gives the Task the Event\'s day)', () => {
    const events = [
      anEvent({ id: 'before', date: '2026-11-20' }),
      anEvent({ id: 'onNext', date: '2026-11-23' }),
      anEvent({ id: 'after', date: '2026-11-25' }),
    ];
    const s = state({ events });

    expect([canPlace(s, 'occ', 'before'), canPlace(s, 'occ', 'onNext'), canPlace(s, 'occ', 'after')]).toEqual([true, false, false]);
    expect(apply(s, { type: 'placeTask', id: 'occ', eventId: 'onNext' }, MON_10_15)).toEqual(NOTHING);
  });

  it("holds the Occurrence's Sub-tasks to the same limit when placing them", () => {
    const sub = aTask({ id: 'sub', parent_id: 'occ', title: 'Soak racks', date: null });
    const s = state({ tasks: [occurrence(), sub], events: [anEvent({ id: 'before', date: '2026-11-20' }), anEvent({ id: 'onNext', date: '2026-11-23' })] });

    expect([canPlace(s, 'sub', 'before'), canPlace(s, 'sub', 'onNext')]).toEqual([true, false]);
  });

  it('has no limit when its series has no later day (the last Occurrence of an ended series)', () => {
    const ended = aSeries({ ...weekly, ends_on: '2026-11-16' });

    expect(canDateTask(state({ series: [ended] }), 'occ', '2026-12-30')).toBe(true);
  });

  it('counts the next segment of the series, so a split does not lift the limit', () => {
    const first = aSeries({ ...weekly, ends_on: '2026-11-22' });
    const second = aSeries({ ...weekly, id: 'weekly-2', lineage_id: 'weekly', anchor_date: '2026-11-23', starts_on: '2026-11-23' });

    expect(canDateTask(state({ series: [first, second] }), 'occ', '2026-11-23')).toBe(false);
  });
});

describe('moving an Event holds the Task Occurrences placed in it to the drag limit', () => {
  const placed = (extra: Partial<State> = {}) =>
    state({ events: [anEvent({ id: 'work', date: '2026-11-16' })], tasks: [{ ...occurrence(), event_id: 'work' }], ...extra });

  it('allows the move to any day before the placed Occurrence\'s next one, and the Task comes along', () => {
    expect([canMoveEvent(placed(), 'work', '2026-11-17'), canMoveEvent(placed(), 'work', '2026-11-22')]).toEqual([true, true]);
    expect(applyChanges(placed(), apply(placed(), { type: 'moveEvent', id: 'work', date: '2026-11-22' }, MON_10_15)).tasks[0]).toMatchObject({ date: '2026-11-22', event_id: 'work' });
  });

  it('refuses the move onto or past the day of the next Occurrence, and changes nothing', () => {
    for (const day of ['2026-11-23', '2026-11-24', '2027-03-01']) {
      expect(canMoveEvent(placed(), 'work', day), day).toBe(false);
      expect(apply(placed(), { type: 'moveEvent', id: 'work', date: day }, MON_10_15), day).toEqual(NOTHING);
    }
  });

  it("holds a placed Sub-task of an Occurrence to its parent's limit", () => {
    const sub = aTask({ id: 'sub', parent_id: 'occ', title: 'Soak racks', date: null, event_id: 'work' });
    const s = state({ events: [anEvent({ id: 'work', date: '2026-11-16' })], tasks: [occurrence(), sub] });

    expect([canMoveEvent(s, 'work', '2026-11-22'), canMoveEvent(s, 'work', '2026-11-23')]).toEqual([true, false]);
  });

  it('does not hold back an Event with only one-off Tasks placed, or none', () => {
    const s = state({ events: [anEvent({ id: 'work', date: '2026-11-16' })], tasks: [aTask({ id: 'one', event_id: 'work' })] });

    expect(canMoveEvent(s, 'work', '2027-03-01')).toBe(true);
  });
});

describe('Event Occurrences have no limit', () => {
  it('can be dragged onto or past the day of their next Occurrence', () => {
    const series = aSeries({ id: 'gym', kind: 'event', rule: 'weekdays', weekdays: '[1]', anchor_date: '2026-11-16', starts_on: '2026-11-16', template: JSON.stringify({ title: 'Gym', start: '18:00', end: '19:00' }) });
    const gym = anEvent({ id: 'gym1', title: 'Gym', date: '2026-11-16', series_id: 'gym', occurrence_date: '2026-11-16' });
    const s = aState({ series: [series], events: [gym] });

    expect([canMoveEvent(s, 'gym1', '2026-11-22'), canMoveEvent(s, 'gym1', '2026-11-23'), canMoveEvent(s, 'gym1', '2026-12-25')]).toEqual([true, true, true]);
    expect(applyChanges(s, apply(s, { type: 'moveEvent', id: 'gym1', date: '2026-11-23' }, MON_10_15)).events[0]!.date).toBe('2026-11-23');
  });
});
