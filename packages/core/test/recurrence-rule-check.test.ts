import { describe, expect, it } from 'vitest';
import { apply, checkRecurrence, type RecurrenceRule } from '../src/index.ts';
import { MON_10_15, aState, aTask } from './helpers.ts';

// What the "Repeat…" picker asks before it offers a rule to the core. The same check is what the core's commands
// apply, so the picker can never accept a rule the core then silently ignores.
describe('checking a Recurrence rule', () => {
  it.each<[string, RecurrenceRule]>([
    ['every day', { rule: 'every_n_days', interval: 1 }],
    ['every 999 days', { rule: 'every_n_days', interval: 999 }],
    ['Monday and Wednesday', { rule: 'weekdays', weekdays: [1, 3] }],
    ['every 52 weeks on Sunday', { rule: 'weekdays', weekdays: [7], everyWeeks: 52 }],
    ['the 1st', { rule: 'day_of_month', day: 1 }],
    ['the 31st', { rule: 'day_of_month', day: 31 }],
  ])('accepts %s', (_name, rule) => {
    expect(checkRecurrence(rule)).toBeNull();
  });

  it.each<[string, RecurrenceRule, RegExp]>([
    ['0 days', { rule: 'every_n_days', interval: 0 }, /days/],
    ['a fraction of a day', { rule: 'every_n_days', interval: 1.5 }, /days/],
    ['more than 999 days', { rule: 'every_n_days', interval: 1000 }, /999/],
    ['not a number of days', { rule: 'every_n_days', interval: Number.NaN }, /days/],
    ['no weekday', { rule: 'weekdays', weekdays: [] }, /at least one weekday/],
    ['a weekday that is not 1 to 7', { rule: 'weekdays', weekdays: [1, 8] }, /weekday/],
    ['0 weeks', { rule: 'weekdays', weekdays: [1], everyWeeks: 0 }, /weeks/],
    ['more than 52 weeks', { rule: 'weekdays', weekdays: [1], everyWeeks: 53 }, /52/],
    ['day 0 of the month', { rule: 'day_of_month', day: 0 }, /1 to 31/],
    ['day 32 of the month', { rule: 'day_of_month', day: 32 }, /1 to 31/],
  ])('refuses %s, saying why', (_name, rule, message) => {
    expect(checkRecurrence(rule)).toMatch(message);
  });

  it('agrees with the commands: a rule is refused by setRecurrence exactly when the check says so', () => {
    const state = aState({ tasks: [aTask({ id: 't' })] });
    const rules: RecurrenceRule[] = [
      { rule: 'every_n_days', interval: 3 },
      { rule: 'every_n_days', interval: 1000 },
      { rule: 'every_n_days', interval: 0 },
      { rule: 'weekdays', weekdays: [] },
      { rule: 'weekdays', weekdays: [2], everyWeeks: 53 },
      { rule: 'weekdays', weekdays: [2], everyWeeks: 2 },
      { rule: 'day_of_month', day: 31 },
      { rule: 'day_of_month', day: 32 },
    ];

    for (const recurrence of rules) {
      const accepted = apply(state, { type: 'setRecurrence', id: 't', seriesId: 's1', recurrence }, MON_10_15).inserts.length > 0;
      expect(accepted, JSON.stringify(recurrence)).toBe(checkRecurrence(recurrence) === null);
    }
  });
});
