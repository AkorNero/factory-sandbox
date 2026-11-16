import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the planner core stays pure', () => {
  it('never reads the real clock, and imports no UI, storage or network packages', () => {
    const dir = new URL('../src/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const src = readFileSync(new URL(file, dir), 'utf8');
      expect(src, file).not.toMatch(/Date\.now\(|new Date\(\)|performance\.now/);
      expect(src, file).not.toMatch(/from '(react|pg|@powersync|node:)/);
    }
  });
});
