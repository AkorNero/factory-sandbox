import { describe, expect, it } from 'vitest';
import { occurrenceDates } from '../src/index.ts';
import { aSeries } from './helpers.ts';

// 2026-11-16 is a Monday. Weekdays are ISO: 1 = Monday ... 7 = Sunday.
describe('which days a Recurrence falls on', () => {
  describe('every N days', () => {
    it('lands every day for N = 1', () => {
      const s = aSeries({ id: 's', rule: 'every_n_days', interval_n: 1 });

      expect(occurrenceDates(s, '2026-11-16', '2026-11-19')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    });

    it('counts N days from the anchor date, whatever window is asked for', () => {
      const s = aSeries({ id: 's', rule: 'every_n_days', interval_n: 3, anchor_date: '2026-11-16', starts_on: '2026-11-16' });

      expect(occurrenceDates(s, '2026-11-17', '2026-11-25')).toEqual(['2026-11-19', '2026-11-22', '2026-11-25']);
    });

    it('does not start before starts-on and stops after ends-on', () => {
      const s = aSeries({ id: 's', interval_n: 2, anchor_date: '2026-11-10', starts_on: '2026-11-16', ends_on: '2026-11-20' });

      expect(occurrenceDates(s, '2026-11-01', '2026-12-01')).toEqual(['2026-11-16', '2026-11-18', '2026-11-20']);
    });
  });

  describe('chosen weekdays', () => {
    it('lands on each chosen weekday', () => {
      const s = aSeries({ id: 's', rule: 'weekdays', interval_n: 1, weekdays: '[1,3]' });

      expect(occurrenceDates(s, '2026-11-16', '2026-11-29')).toEqual(['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25']);
    });

    it("with every N weeks, counts weeks (Monday to Sunday) from the anchor date's week", () => {
      // anchored on Wednesday 18 Nov: its week is week 0, so Monday 16 Nov is before the start
      const s = aSeries({ id: 's', rule: 'weekdays', interval_n: 2, weekdays: '[1,3]', anchor_date: '2026-11-18', starts_on: '2026-11-18' });

      expect(occurrenceDates(s, '2026-11-16', '2026-12-13')).toEqual(['2026-11-18', '2026-11-30', '2026-12-02']);
    });
  });

  describe('day of month', () => {
    const monthly = (day: number) =>
      aSeries({ id: 's', rule: 'day_of_month', day_of_month: day, interval_n: null, anchor_date: '2026-01-01', starts_on: '2026-01-01' });

    it('lands on that day each month', () => {
      expect(occurrenceDates(monthly(15), '2026-11-01', '2027-01-31')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    });

    it('the 31st falls back to the last day of shorter months', () => {
      expect(occurrenceDates(monthly(31), '2026-03-01', '2026-06-30')).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    });

    it('the 31st lands on 28 February in a common year and 29 in a leap year', () => {
      expect(occurrenceDates(monthly(31), '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
      expect(occurrenceDates(monthly(31), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
    });

    it('the 30th falls back to 28 February too', () => {
      expect(occurrenceDates(monthly(30), '2027-02-01', '2027-03-31')).toEqual(['2027-02-28', '2027-03-30']);
    });
  });

  it('returns nothing for a reversed window', () => {
    expect(occurrenceDates(aSeries({ id: 's' }), '2026-11-20', '2026-11-19')).toEqual([]);
  });
});
