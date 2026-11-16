import { describe, expect, it } from 'vitest';
import { occurrenceId, occurrenceSubtaskId } from '../src/index.ts';

describe('Occurrence ids', () => {
  it('are fixed by the series and the day, so two devices derive the same one', () => {
    expect(occurrenceId('series-1', '2026-11-16')).toBe(occurrenceId('series-1', '2026-11-16'));
  });

  it('differ per day and per series', () => {
    const id = occurrenceId('series-1', '2026-11-16');

    expect(occurrenceId('series-1', '2026-11-17')).not.toBe(id);
    expect(occurrenceId('series-2', '2026-11-16')).not.toBe(id);
  });

  it('match pinned values, so a library upgrade cannot change the ids of live data (vectors from Python uuid5)', () => {
    expect(occurrenceId('series-1', '2026-11-16')).toBe('b296c73e-4ec2-5489-a437-b5603102cb80');
    expect(occurrenceSubtaskId(occurrenceId('series-1', '2026-11-16'), 'sub-a')).toBe('fd908770-8b1e-5ffd-ac52-4024e1ae5528');
  });

  it("make a Sub-task's id from its Occurrence and its series Sub-task key", () => {
    const occ = occurrenceId('series-1', '2026-11-16');

    expect(occurrenceSubtaskId(occ, 'sub-a')).toBe(occurrenceSubtaskId(occ, 'sub-a'));
    expect(occurrenceSubtaskId(occ, 'sub-b')).not.toBe(occurrenceSubtaskId(occ, 'sub-a'));
    expect(occurrenceSubtaskId(occurrenceId('series-1', '2026-11-17'), 'sub-a')).not.toBe(occurrenceSubtaskId(occ, 'sub-a'));
  });
});
