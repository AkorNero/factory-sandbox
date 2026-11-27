import { describe, expect, it } from 'vitest';
import { apply } from '../src/index.ts';
import { MON_10_15, TODAY, aState, anEvent } from './helpers.ts';

const LATER = '2026-11-16T10:30:00+01:00';

describe('adding an Event', () => {
  it('returns the new Event as one inserted row, with timestamps from "now"', () => {
    const changes = apply(
      aState(),
      { type: 'addEvent', id: 'e1', title: ' Gym ', date: TODAY, start: '18:00', end: '19:00' },
      MON_10_15,
    );

    expect(changes.updates).toEqual([]);
    expect(changes.deletes).toEqual([]);
    expect(changes.inserts).toEqual([
      {
        table: 'events',
        row: {
          id: 'e1',
          title: 'Gym',
          date: TODAY,
          start_time: '18:00',
          end_time: '19:00',
          series_id: null,
          occurrence_date: null,
          deleted_at: null,
          created_at: MON_10_15,
          updated_at: MON_10_15,
        },
      },
    ]);
  });

  it('adds nothing for an empty title or for times that break the rule (end after start, same day)', () => {
    const add = (title: string, start: string, end: string) =>
      apply(aState(), { type: 'addEvent', id: 'e1', title, date: TODAY, start, end }, MON_10_15);

    expect(add('  ', '18:00', '19:00').inserts).toEqual([]);
    expect(add('Gym', '19:00', '18:00').inserts).toEqual([]);
    expect(add('Gym', '18:00', '18:00').inserts).toEqual([]);
    expect(add('Gym', '18:00', '24:00').inserts).toEqual([]);
  });
});

describe('renaming an Event', () => {
  it('updates only the title (and updated_at)', () => {
    const state = aState({ events: [anEvent({ id: 'e1', title: 'Gym' })] });

    const changes = apply(state, { type: 'renameEvent', id: 'e1', title: ' Climbing ' }, LATER);

    expect(changes.inserts).toEqual([]);
    expect(changes.updates).toEqual([{ table: 'events', id: 'e1', set: { title: 'Climbing', updated_at: LATER } }]);
  });

  it('ignores an empty title, an unchanged title and an Event that is not there', () => {
    const state = aState({ events: [anEvent({ id: 'e1', title: 'Gym' })] });

    expect(apply(state, { type: 'renameEvent', id: 'e1', title: '  ' }, LATER)).toEqual({ inserts: [], updates: [], deletes: [] });
    expect(apply(state, { type: 'renameEvent', id: 'e1', title: 'Gym' }, LATER).updates).toEqual([]);
    expect(apply(state, { type: 'renameEvent', id: 'nope', title: 'X' }, LATER).updates).toEqual([]);
  });
});

describe('changing an Event\'s times', () => {
  it('updates only the columns that changed', () => {
    const state = aState({ events: [anEvent({ id: 'e1', start_time: '09:00', end_time: '10:00' })] });

    const changes = apply(state, { type: 'setEventTimes', id: 'e1', start: '09:00', end: '11:30' }, LATER);

    expect(changes.updates).toEqual([{ table: 'events', id: 'e1', set: { end_time: '11:30', updated_at: LATER } }]);
  });

  it('accepts times typed as H or H:MM and stores HH:MM', () => {
    const state = aState({ events: [anEvent({ id: 'e1', start_time: '09:00', end_time: '10:00' })] });

    const changes = apply(state, { type: 'setEventTimes', id: 'e1', start: '8:30', end: '10:00' }, LATER);

    expect(changes.updates[0]?.set).toEqual({ start_time: '08:30', updated_at: LATER });
  });

  it('refuses an end that is not after the start', () => {
    const state = aState({ events: [anEvent({ id: 'e1' })] });

    expect(apply(state, { type: 'setEventTimes', id: 'e1', start: '10:00', end: '10:00' }, LATER).updates).toEqual([]);
    expect(apply(state, { type: 'setEventTimes', id: 'e1', start: '11:00', end: '10:00' }, LATER).updates).toEqual([]);
  });
});

describe('deleting an Event', () => {
  it('removes the row', () => {
    const state = aState({ events: [anEvent({ id: 'e1', start_time: '18:00', end_time: '19:00' })] });

    const changes = apply(state, { type: 'deleteEvent', id: 'e1' }, LATER);

    expect(changes.deletes).toEqual([{ table: 'events', id: 'e1' }]);
  });

  it('does nothing for an Event that is not there', () => {
    expect(apply(aState(), { type: 'deleteEvent', id: 'nope' }, LATER).deletes).toEqual([]);
  });
});
