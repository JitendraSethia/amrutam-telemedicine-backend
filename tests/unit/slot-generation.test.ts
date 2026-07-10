import { describe, it, expect } from 'vitest';
import { generateSlots } from '../../src/modules/availability/slot-generation.js';

describe('generateSlots', () => {
  it('splits a block into fixed-length slots', () => {
    const slots = generateSlots(
      [{ start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z' }],
      30,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      start: '2030-01-01T10:00:00.000Z',
      end: '2030-01-01T10:30:00.000Z',
    });
    expect(slots[1].start).toBe('2030-01-01T10:30:00.000Z');
  });

  it('drops a trailing partial slot', () => {
    const slots = generateSlots(
      [{ start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T10:50:00.000Z' }],
      30,
    );
    expect(slots).toHaveLength(1); // 10:00–10:30 only; 20 min remainder dropped
  });

  it('handles multiple blocks', () => {
    const slots = generateSlots(
      [
        { start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T10:30:00.000Z' },
        { start: '2030-01-01T14:00:00.000Z', end: '2030-01-01T14:30:00.000Z' },
      ],
      30,
    );
    expect(slots).toHaveLength(2);
  });

  it('rejects inverted blocks', () => {
    expect(() =>
      generateSlots([{ start: '2030-01-01T11:00:00.000Z', end: '2030-01-01T10:00:00.000Z' }], 30),
    ).toThrow();
  });

  it('rejects invalid slot durations', () => {
    expect(() =>
      generateSlots([{ start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z' }], 3),
    ).toThrow();
  });

  it('rejects blocks longer than 24h', () => {
    expect(() =>
      generateSlots([{ start: '2030-01-01T00:00:00.000Z', end: '2030-01-02T01:00:00.000Z' }], 30),
    ).toThrow();
  });
});
