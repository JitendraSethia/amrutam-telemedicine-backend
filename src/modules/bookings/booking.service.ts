import { db } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { encryptField } from '../../utils/crypto.js';
import { enqueue } from '../../jobs/queue.js';
import { bookingsTotal, sagaSteps } from '../../observability/metrics.js';
import { logger } from '../../observability/logger.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  SlotUnavailableError,
  ValidationError,
} from '../../utils/errors.js';
import { AvailabilityRepository } from '../availability/availability.repository.js';
import { ConsultationsRepository } from '../consultations/consultations.repository.js';
import { ConsultationsService, type ConsultationDTO } from '../consultations/consultations.service.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { PaymentGateway } from '../payments/payments.gateway.js';
import { SagaRepository } from './saga.repository.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../../types/context.js';
import type { RequestMeta } from '../auth/auth.service.js';

export interface BookInput {
  slotId: string;
  mode: 'video' | 'audio' | 'chat';
  reason?: string;
}

/**
 * BOOKING SAGA (orchestration + compensation).
 *
 * The happy path is three atomic steps; any failure compensates prior steps so
 * the system never ends up with a held slot and no consultation, or a charge
 * with no booking.
 *
 *   Step 1 RESERVE  — lock slot (FOR UPDATE), assert available, mark 'held',
 *                     create consultation (pending_payment), persist saga.
 *   Step 2 CHARGE   — create + capture payment via the gateway (idempotent).
 *   Step 3 CONFIRM  — mark slot 'booked', consultation 'scheduled', saga done.
 *
 *   Compensation    — cancel consultation, release the slot (iff still held by
 *                     this booker), fail the payment, mark saga compensated.
 *
 * Concurrency: two patients racing for the same slot serialise on the row lock
 * in step 1; the loser sees status≠available → 409. The partial unique index
 * `consultations_active_slot_uq` is the database-level backstop. The endpoint
 * is additionally guarded by the idempotency plugin (Idempotency-Key header).
 */
export class BookingService {
  constructor(
    private readonly slots: AvailabilityRepository,
    private readonly consultationsRepo: ConsultationsRepository,
    private readonly consultations: ConsultationsService,
    private readonly payments: PaymentsRepository,
    private readonly gateway: PaymentGateway,
    private readonly sagas: SagaRepository,
    private readonly audit: AuditService,
  ) {}

  async book(user: AuthenticatedUser, input: BookInput, meta: RequestMeta): Promise<ConsultationDTO> {
    // ── Step 1: RESERVE (single transaction) ─────────────────────────────────
    const reserved = await db.tx(async (client) => {
      const slot = await this.slots.lockSlot(client, input.slotId);
      if (!slot) throw new NotFoundError('Slot');
      if (new Date(slot.start_ts).getTime() <= Date.now()) {
        throw new ValidationError('Cannot book a slot in the past');
      }
      if (slot.status !== 'available') throw new SlotUnavailableError();

      const docRes = await client.query<{
        id: string;
        consultation_fee: string;
        currency: string;
        is_accepting: boolean;
      }>(`SELECT id, consultation_fee, currency, is_accepting FROM doctors WHERE id = $1 FOR SHARE`, [
        slot.doctor_id,
      ]);
      const doctor = docRes.rows[0];
      if (!doctor) throw new NotFoundError('Doctor');
      if (!doctor.is_accepting) throw new ConflictError('Doctor is not accepting bookings', 'NOT_ACCEPTING');

      const holdExpiresAt = new Date(Date.now() + env.SLOT_HOLD_TTL_SECONDS * 1000).toISOString();
      await this.slots.setStatus(client, slot.id, 'held', {
        heldBy: user.id,
        holdExpiresAt,
      });

      const consultation = await this.consultationsRepo.create(client, {
        patientId: user.id,
        doctorId: doctor.id,
        slotId: slot.id,
        mode: input.mode,
        reasonEnc: input.reason ? encryptField(input.reason) : null,
        scheduledStart: slot.start_ts,
        scheduledEnd: slot.end_ts,
        feeAmount: Number(doctor.consultation_fee),
        currency: doctor.currency,
      });

      const sagaId = await this.sagas.create(client, {
        type: 'booking',
        currentStep: 'charge_payment',
        correlationId: consultation.id,
        context: {
          consultationId: consultation.id,
          slotId: slot.id,
          patientId: user.id,
          amount: Number(doctor.consultation_fee),
          currency: doctor.currency,
        },
      });

      await this.sagas.emit(client, {
        aggregateType: 'consultation',
        aggregateId: consultation.id,
        eventType: 'booking.created',
        payload: { slotId: slot.id, patientId: user.id },
      });

      await this.audit.record(
        {
          actorUserId: user.id,
          actorRole: 'patient',
          action: 'consultation.booking_initiated',
          resourceType: 'consultation',
          resourceId: consultation.id,
          ip: meta.ip,
          requestId: meta.requestId,
          metadata: { slotId: slot.id, doctorId: doctor.id },
        },
        client,
      );

      return {
        consultationId: consultation.id,
        slotId: slot.id,
        sagaId,
        amount: Number(doctor.consultation_fee),
        currency: doctor.currency,
      };
    });

    // Safety net: if the process dies before step 3, this delayed job compensates.
    await enqueue(
      'booking.timeout',
      { consultationId: reserved.consultationId, sagaId: reserved.sagaId },
      { delay: (env.SLOT_HOLD_TTL_SECONDS + 15) * 1000 },
    );

    // ── Step 2 + 3: CHARGE then CONFIRM ──────────────────────────────────────
    try {
      const payment = await db.tx((client) =>
        this.payments.create(client, {
          consultationId: reserved.consultationId,
          patientId: user.id,
          amount: reserved.amount,
          currency: reserved.currency,
          idempotencyKey: `pay_${reserved.consultationId}`,
        }),
      );
      await this.payments.updateStatus(payment.id, 'processing');

      const charge = await this.gateway.charge({
        amount: reserved.amount,
        currency: reserved.currency,
        idempotencyKey: payment.idempotency_key,
      });

      if (charge.status !== 'succeeded') {
        await this.compensate(reserved, payment.id, charge.failureReason ?? 'payment_failed', user);
        bookingsTotal.inc({ outcome: 'payment_failed' });
        throw new AppError('Payment was declined', {
          statusCode: 402,
          code: 'PAYMENT_FAILED',
          details: { reason: charge.failureReason },
        });
      }

      await db.tx(async (client) => {
        await this.payments.updateStatus(payment.id, 'succeeded', { providerRef: charge.providerRef }, client);
        const slot = await this.slots.lockSlot(client, reserved.slotId);
        if (slot && slot.status === 'held' && slot.held_by === user.id) {
          await this.slots.setStatus(client, reserved.slotId, 'booked', { holdExpiresAt: null });
        }
        await this.consultationsRepo.updateStatus(reserved.consultationId, 'scheduled', {}, client);
        await this.sagas.advance(
          reserved.sagaId,
          { currentStep: 'completed', completedStep: 'charge_payment' },
          client,
        );
        await this.sagas.setStatus(reserved.sagaId, 'completed', {}, client);
        await this.sagas.emit(client, {
          aggregateType: 'consultation',
          aggregateId: reserved.consultationId,
          eventType: 'consultation.scheduled',
          payload: { paymentId: payment.id },
        });
      });

      sagaSteps.inc({ saga: 'booking', step: 'confirm', status: 'ok' });
      bookingsTotal.inc({ outcome: 'confirmed' });

      await enqueue('notification.send', {
        to: user.id,
        template: 'booking_confirmed',
        data: { consultationId: reserved.consultationId },
      });
      await this.audit.record({
        actorUserId: user.id,
        actorRole: 'patient',
        action: 'consultation.booked',
        resourceType: 'consultation',
        resourceId: reserved.consultationId,
        ip: meta.ip,
        requestId: meta.requestId,
        metadata: { paymentId: payment.id },
      });

      return this.consultations.getForViewer(user, reserved.consultationId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'PAYMENT_FAILED') throw err;
      // Unexpected failure mid-charge: compensate best-effort and rethrow so the
      // idempotency layer releases the claim (5xx ⇒ safe to retry).
      logger.error({ err, sagaId: reserved.sagaId }, 'Booking saga failed during charge');
      await this.compensate(reserved, undefined, 'saga_error', user).catch((e) =>
        logger.error({ err: e }, 'Compensation failed'),
      );
      throw err;
    }
  }

  /** Compensating transaction: undo a reservation. Safe to call more than once. */
  private async compensate(
    reserved: { consultationId: string; slotId: string; sagaId: string },
    paymentId: string | undefined,
    reason: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await db.tx(async (client) => {
      await this.sagas.setStatus(reserved.sagaId, 'compensating', { lastError: reason }, client);
      await this.consultationsRepo.updateStatus(
        reserved.consultationId,
        'cancelled',
        { cancelledAt: new Date().toISOString(), cancellationReason: reason },
        client,
      );
      const slot = await this.slots.lockSlot(client, reserved.slotId);
      // Only release if THIS booking still holds it (avoid stealing a slot that
      // was reaped and re-booked by someone else).
      if (slot && slot.status === 'held' && slot.held_by === user.id) {
        await this.slots.setStatus(client, reserved.slotId, 'available');
      }
      if (paymentId) {
        await this.payments.updateStatus(paymentId, 'failed', { failureReason: reason }, client);
      }
      await this.sagas.advance(reserved.sagaId, { currentStep: 'compensated' }, client);
      await this.sagas.setStatus(reserved.sagaId, 'compensated', {}, client);
      await this.sagas.emit(client, {
        aggregateType: 'consultation',
        aggregateId: reserved.consultationId,
        eventType: 'booking.compensated',
        payload: { reason },
      });
    });
    sagaSteps.inc({ saga: 'booking', step: 'compensate', status: 'compensated' });
  }

  /**
   * Invoked by the delayed `booking.timeout` job. If the consultation is still
   * awaiting payment after the hold window, the saga stalled → compensate.
   */
  async handleTimeout(consultationId: string, sagaId: string): Promise<void> {
    const c = await this.consultationsRepo.findById(consultationId);
    if (!c || c.status !== 'pending_payment') return; // already resolved
    await db.tx(async (client) => {
      await this.consultationsRepo.updateStatus(
        consultationId,
        'cancelled',
        { cancelledAt: new Date().toISOString(), cancellationReason: 'payment_timeout' },
        client,
      );
      const slot = await this.slots.lockSlot(client, c.slot_id);
      if (slot && slot.status === 'held' && slot.held_by === c.patient_id) {
        await this.slots.setStatus(client, c.slot_id, 'available');
      }
      await this.sagas.setStatus(sagaId, 'compensated', { lastError: 'payment_timeout' }, client);
    });
    bookingsTotal.inc({ outcome: 'cancelled' });
  }
}
