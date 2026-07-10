import { db } from '../../db/pool.js';
import { decryptField, encryptField } from '../../utils/crypto.js';
import { enqueue } from '../../jobs/queue.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  ConsultationsRepository,
  type ConsultationRow,
  type ConsultationStatus,
} from './consultations.repository.js';
import { AvailabilityRepository } from '../availability/availability.repository.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../../types/context.js';
import type { RequestMeta } from '../auth/auth.service.js';
import type { Page } from '../../utils/pagination.js';

export interface ConsultationDTO {
  id: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  status: ConsultationStatus;
  mode: string;
  reason: string | null;
  notes: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string | null;
  endedAt: string | null;
  cancellationReason: string | null;
  feeAmount: number;
  currency: string;
  createdAt: string;
}

// Allowed status transitions (state machine). Any transition not listed is a 409.
const TRANSITIONS: Record<ConsultationStatus, ConsultationStatus[]> = {
  pending_payment: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export class ConsultationsService {
  constructor(
    private readonly repo: ConsultationsRepository,
    private readonly slots: AvailabilityRepository,
    private readonly payments: PaymentsRepository,
    private readonly audit: AuditService,
  ) {}

  private async resolveDoctorId(user: AuthenticatedUser): Promise<string | undefined> {
    if (user.doctorId) return user.doctorId;
    const res = await db.query<{ id: string }>(`SELECT id FROM doctors WHERE user_id = $1`, [
      user.id,
    ]);
    return res.rows[0]?.id;
  }

  private async assertParticipant(user: AuthenticatedUser, c: ConsultationRow): Promise<'patient' | 'doctor'> {
    if (user.role === 'patient' && c.patient_id === user.id) return 'patient';
    if (user.role === 'doctor') {
      const doctorId = await this.resolveDoctorId(user);
      if (doctorId && c.doctor_id === doctorId) return 'doctor';
    }
    throw new ForbiddenError('You are not a participant in this consultation');
  }

  private toDTO(c: ConsultationRow, viewer: 'patient' | 'doctor' | 'admin'): ConsultationDTO {
    // Admins get metadata only — clinical PHI (reason/notes) stays encrypted to
    // enforce data minimisation.
    const clinical = viewer !== 'admin';
    return {
      id: c.id,
      patientId: c.patient_id,
      doctorId: c.doctor_id,
      slotId: c.slot_id,
      status: c.status,
      mode: c.mode,
      reason: clinical ? decryptField(c.reason_enc) : null,
      notes: clinical ? decryptField(c.notes_enc) : null,
      scheduledStart: c.scheduled_start,
      scheduledEnd: c.scheduled_end,
      startedAt: c.started_at,
      endedAt: c.ended_at,
      cancellationReason: c.cancellation_reason,
      feeAmount: Number(c.fee_amount),
      currency: c.currency,
      createdAt: c.created_at,
    };
  }

  async getForViewer(user: AuthenticatedUser, id: string): Promise<ConsultationDTO> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    if (user.role === 'admin') return this.toDTO(c, 'admin');
    const role = await this.assertParticipant(user, c);
    return this.toDTO(c, role);
  }

  async list(
    user: AuthenticatedUser,
    filters: { status?: ConsultationStatus; limit: number; cursor?: string },
  ): Promise<Page<ConsultationDTO>> {
    if (user.role === 'patient') {
      const page = await this.repo.listForParty('patient', user.id, filters);
      return { items: page.items.map((c) => this.toDTO(c, 'patient')), nextCursor: page.nextCursor };
    }
    if (user.role === 'doctor') {
      const doctorId = await this.resolveDoctorId(user);
      if (!doctorId) throw new ForbiddenError('No doctor profile');
      const page = await this.repo.listForParty('doctor', doctorId, filters);
      return { items: page.items.map((c) => this.toDTO(c, 'doctor')), nextCursor: page.nextCursor };
    }
    throw new ForbiddenError('Use admin analytics endpoints');
  }

  private assertTransition(from: ConsultationStatus, to: ConsultationStatus): void {
    if (!TRANSITIONS[from].includes(to)) {
      throw new ValidationError(`Illegal transition ${from} → ${to}`);
    }
  }

  async start(user: AuthenticatedUser, id: string, meta: RequestMeta): Promise<ConsultationDTO> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    const role = await this.assertParticipant(user, c);
    if (role !== 'doctor') throw new ForbiddenError('Only the doctor can start the consultation');
    this.assertTransition(c.status, 'in_progress');
    await this.repo.updateStatus(id, 'in_progress', { startedAt: new Date().toISOString() });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'doctor',
      action: 'consultation.started',
      resourceType: 'consultation',
      resourceId: id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.getForViewer(user, id);
  }

  async complete(
    user: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<ConsultationDTO> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    const role = await this.assertParticipant(user, c);
    if (role !== 'doctor') throw new ForbiddenError('Only the doctor can complete the consultation');
    this.assertTransition(c.status, 'completed');
    await this.repo.updateStatus(id, 'completed', { endedAt: new Date().toISOString() });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'doctor',
      action: 'consultation.completed',
      resourceType: 'consultation',
      resourceId: id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    await enqueue('notification.send', {
      to: c.patient_id,
      template: 'consultation_completed',
      data: { consultationId: id },
    });
    return this.getForViewer(user, id);
  }

  async addNotes(
    user: AuthenticatedUser,
    id: string,
    notes: string,
    meta: RequestMeta,
  ): Promise<void> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    const role = await this.assertParticipant(user, c);
    if (role !== 'doctor') throw new ForbiddenError('Only the doctor can add clinical notes');
    if (!['in_progress', 'completed'].includes(c.status)) {
      throw new ValidationError('Notes can only be added during or after the consultation');
    }
    await this.repo.setNotes(id, encryptField(notes)!);
    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'doctor',
      action: 'consultation.notes_updated',
      resourceType: 'consultation',
      resourceId: id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    rating: number,
    comment: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    if (user.role !== 'patient' || c.patient_id !== user.id) {
      throw new ForbiddenError('Only the patient can review this consultation');
    }
    if (c.status !== 'completed') {
      throw new ValidationError('Only completed consultations can be reviewed');
    }
    try {
      await db.query(
        `INSERT INTO reviews (consultation_id, doctor_id, patient_id, rating, comment)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, c.doctor_id, c.patient_id, rating, comment ?? null],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('This consultation has already been reviewed', 'ALREADY_REVIEWED');
      }
      throw err;
    }
    await enqueue('rating.recompute', { doctorId: c.doctor_id });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'patient',
      action: 'consultation.reviewed',
      resourceType: 'consultation',
      resourceId: id,
      ip: meta.ip,
      requestId: meta.requestId,
      metadata: { rating },
    });
  }

  async cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<ConsultationDTO> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Consultation');
    await this.assertParticipant(user, c);
    if (!['pending_payment', 'scheduled'].includes(c.status)) {
      throw new ValidationError(`Cannot cancel a ${c.status} consultation`);
    }

    // Free the slot + cancel the consultation atomically.
    await db.tx(async (client) => {
      await this.repo.updateStatus(
        id,
        'cancelled',
        { cancelledAt: new Date().toISOString(), cancellationReason: reason },
        client,
      );
      const slot = await this.slots.lockSlot(client, c.slot_id);
      if (slot && slot.status !== 'available') {
        await this.slots.setStatus(client, c.slot_id, 'available');
      }
    });

    // Refund asynchronously if there was a successful payment.
    const payment = await this.payments.findByConsultation(id);
    if (payment && payment.status === 'succeeded') {
      await enqueue('payment.refund', { paymentId: payment.id, reason: 'consultation_cancelled' });
    }
    await enqueue('notification.send', {
      to: c.patient_id,
      template: 'consultation_cancelled',
      data: { consultationId: id, reason },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'consultation.cancelled',
      resourceType: 'consultation',
      resourceId: id,
      ip: meta.ip,
      requestId: meta.requestId,
      metadata: { reason },
    });
    return this.getForViewer(user, id);
  }
}
