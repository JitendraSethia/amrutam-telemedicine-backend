import { AvailabilityRepository, type PublicSlot } from './availability.repository.js';
import { DoctorsService } from '../doctors/doctors.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ValidationError } from '../../utils/errors.js';
import { generateSlots, type AvailabilityBlock } from './slot-generation.js';
import type { RequestMeta } from '../auth/auth.service.js';

export { generateSlots, type AvailabilityBlock } from './slot-generation.js';

export class AvailabilityService {
  constructor(
    private readonly repo: AvailabilityRepository,
    private readonly doctors: DoctorsService,
    private readonly audit: AuditService,
  ) {}

  async createAvailability(
    userId: string,
    input: { slotMinutes: number; blocks: AvailabilityBlock[] },
    meta: RequestMeta,
  ): Promise<{ created: number }> {
    const doctorId = await this.doctors.requireDoctorId(userId);
    const now = Date.now();
    for (const b of input.blocks) {
      if (new Date(b.start).getTime() < now) {
        throw new ValidationError('Cannot create availability in the past');
      }
    }
    const slots = generateSlots(input.blocks, input.slotMinutes);
    const created = await this.repo.bulkInsert(doctorId, slots);
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'doctor',
      action: 'availability.created',
      resourceType: 'doctor',
      resourceId: doctorId,
      ip: meta.ip,
      requestId: meta.requestId,
      metadata: { requested: slots.length, created },
    });
    return { created };
  }

  async listSlots(doctorId: string, from: string, to: string, limit: number): Promise<PublicSlot[]> {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
      throw new ValidationError('Invalid from/to window');
    }
    if (toMs - fromMs > 62 * 24 * 3600_000) {
      throw new ValidationError('Window cannot exceed 62 days');
    }
    return this.repo.listAvailable(doctorId, from, to, limit);
  }
}
