import { ValidationError } from '../../utils/errors.js';

export const MAX_SLOTS_PER_REQUEST = 1000;

export interface AvailabilityBlock {
  start: string; // ISO datetime
  end: string; // ISO datetime
}

/**
 * Expand time blocks into fixed-length discrete slots. Pure function (no I/O) so
 * it is exhaustively unit-testable. Guards against inverted/oversized blocks and
 * runaway slot counts.
 */
export function generateSlots(
  blocks: AvailabilityBlock[],
  slotMinutes: number,
): { start: string; end: string }[] {
  if (slotMinutes < 5 || slotMinutes > 240) {
    throw new ValidationError('slotMinutes must be between 5 and 240');
  }
  const slotMs = slotMinutes * 60_000;
  const out: { start: string; end: string }[] = [];
  for (const block of blocks) {
    const start = new Date(block.start).getTime();
    const end = new Date(block.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new ValidationError('Invalid block datetime');
    }
    if (end <= start) throw new ValidationError('Block end must be after start');
    if (end - start > 24 * 3600_000) throw new ValidationError('A block may not exceed 24h');
    for (let t = start; t + slotMs <= end; t += slotMs) {
      out.push({ start: new Date(t).toISOString(), end: new Date(t + slotMs).toISOString() });
      if (out.length > MAX_SLOTS_PER_REQUEST) {
        throw new ValidationError(`Cannot create more than ${MAX_SLOTS_PER_REQUEST} slots per request`);
      }
    }
  }
  return out;
}
