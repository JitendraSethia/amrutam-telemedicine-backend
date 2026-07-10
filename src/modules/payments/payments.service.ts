import { redis } from '../../cache/redis.js';
import { env } from '../../config/env.js';
import { hmacHex, safeEqual } from '../../utils/crypto.js';
import { logger } from '../../observability/logger.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors.js';
import { PaymentsRepository, type PaymentRow } from './payments.repository.js';
import { PaymentGateway } from './payments.gateway.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../../types/context.js';

export interface PaymentDTO {
  id: string;
  consultationId: string;
  amount: number;
  currency: string;
  status: string;
  refundedAmount: number;
  createdAt: string;
}

interface WebhookEvent {
  id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  data: { providerRef: string; failureReason?: string; amount?: number };
}

export class PaymentsService {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
  ) {}

  private toDTO(p: PaymentRow): PaymentDTO {
    return {
      id: p.id,
      consultationId: p.consultation_id,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      refundedAmount: Number(p.refunded_amount),
      createdAt: p.created_at,
    };
  }

  async getForViewer(user: AuthenticatedUser, id: string): Promise<PaymentDTO> {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundError('Payment');
    if (user.role !== 'admin' && p.patient_id !== user.id) {
      throw new ForbiddenError('Not authorised to view this payment');
    }
    return this.toDTO(p);
  }

  /** Called by the `payment.refund` worker (async). Idempotent: a payment that
   * is not in `succeeded` state is skipped. */
  async refund(paymentId: string, reason: string): Promise<void> {
    const p = await this.repo.findById(paymentId);
    if (!p) throw new NotFoundError('Payment');
    if (p.status !== 'succeeded' || !p.provider_ref) {
      logger.warn({ paymentId, status: p.status }, 'Refund skipped (payment not refundable)');
      return;
    }
    await this.gateway.refund(p.provider_ref, Number(p.amount));
    await this.repo.markRefunded(paymentId, Number(p.amount));
    await this.audit.record({
      action: 'payment.refunded',
      resourceType: 'payment',
      resourceId: paymentId,
      metadata: { reason, amount: Number(p.amount) },
    });
  }

  /**
   * Secure webhook ingestion from the payment provider. Steps:
   *   1. Verify the HMAC signature over the RAW body (constant-time compare).
   *   2. De-duplicate by provider event id (Redis SETNX) — providers retry, so
   *      handlers MUST be idempotent.
   *   3. Apply the state change (also idempotent by current status).
   */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<{ received: true }> {
    if (!signature) throw new UnauthorizedError('Missing webhook signature', 'WEBHOOK_UNSIGNED');
    const expected = hmacHex(env.PAYMENT_WEBHOOK_SECRET, rawBody);
    if (!safeEqual(expected, signature)) {
      throw new UnauthorizedError('Invalid webhook signature', 'WEBHOOK_BAD_SIGNATURE');
    }

    const event = JSON.parse(rawBody) as WebhookEvent;
    // Idempotency: process each provider event id at most once.
    const fresh = await redis.set(`webhook:pay:${event.id}`, '1', 'EX', 86400, 'NX');
    if (!fresh) return { received: true };

    const payment = await this.repo.findByProviderRef(event.data.providerRef);
    if (!payment) {
      logger.warn({ providerRef: event.data.providerRef }, 'Webhook for unknown payment');
      return { received: true };
    }

    switch (event.type) {
      case 'payment.succeeded':
        if (payment.status !== 'succeeded') {
          await this.repo.updateStatus(payment.id, 'succeeded', { providerRef: event.data.providerRef });
        }
        break;
      case 'payment.failed':
        if (payment.status !== 'succeeded') {
          await this.repo.updateStatus(payment.id, 'failed', {
            failureReason: event.data.failureReason ?? 'provider_failed',
          });
        }
        break;
      case 'payment.refunded':
        if (payment.status !== 'refunded') {
          await this.repo.markRefunded(payment.id, event.data.amount ?? Number(payment.amount));
        }
        break;
    }

    await this.audit.record({
      action: `webhook.${event.type}`,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { eventId: event.id },
    });
    return { received: true };
  }
}
