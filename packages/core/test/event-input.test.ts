import { describe, expect, it } from 'vitest';
import { checkEventTimes, parseEventInput } from '../src/index.ts';

describe('typing an Event at the end of Later today', () => {
  it('reads "Gym 18-19" as an Event from 18:00 to 19:00', () => {
    expect(parseEventInput('Gym 18-19')).toEqual({ ok: true, title: 'Gym', start: '18:00', end: '19:00' });
  });

  it('reads "Gym 18:30-19:15" with minutes', () => {
    expect(parseEventInput('Gym 18:30-19:15')).toEqual({ ok: true, title: 'Gym', start: '18:30', end: '19:15' });
  });

  it('keeps multi-word titles, pads single-digit hours and tolerates spaces around the dash', () => {
    expect(parseEventInput('  Team stand-up 9 - 9:30 ')).toEqual({
      ok: true,
      title: 'Team stand-up',
      start: '09:00',
      end: '09:30',
    });
  });

  it('asks for a time when there is none', () => {
    expect(parseEventInput('Gym')).toMatchObject({ ok: false, error: expect.stringContaining('Gym 18-19') });
    expect(parseEventInput('Gym 18')).toMatchObject({ ok: false });
  });

  it('asks for a name when there is only a time', () => {
    expect(parseEventInput('18-19')).toMatchObject({ ok: false, error: expect.stringMatching(/name/i) });
  });

  it('rejects an Event that does not end after it starts (same day only)', () => {
    for (const text of ['Gym 19-18', 'Gym 18-18', 'Night shift 22-2']) {
      expect(parseEventInput(text), text).toMatchObject({ ok: false, error: expect.stringMatching(/end after/i) });
    }
  });

  it('rejects clock times that do not exist', () => {
    for (const text of ['Gym 25-26', 'Gym 18:60-19', 'Gym 18-24']) {
      expect(parseEventInput(text), text).toMatchObject({ ok: false });
    }
  });
});

describe('checking an Event\'s times from its menu', () => {
  it('accepts a start before the end', () => {
    expect(checkEventTimes('09:00', '09:01')).toBeNull();
  });

  it('refuses an end that is not after the start, and times that are not clock times', () => {
    expect(checkEventTimes('10:00', '10:00')).toMatch(/end after/i);
    expect(checkEventTimes('10:00', '09:00')).toMatch(/end after/i);
    expect(checkEventTimes('', '09:00')).not.toBeNull();
    expect(checkEventTimes('09:00', '24:00')).not.toBeNull();
  });
});
