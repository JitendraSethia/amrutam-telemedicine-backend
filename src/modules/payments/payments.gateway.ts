import { randomToken } from '../../utils/crypto.js';

/**
 * Mock payment gateway. In production this wraps a real PSP (Razorpay/Stripe).
 * The interface is what matters for the assignment:
 *   - `charge` is IDEMPOTENT on `idempotencyKey` — retrying never double-charges.
 *   - it returns a provider reference used to reconcile async webhooks.
 * Determinism for tests: an amount whose paise part is `.13` simulates a
 * decline; everything else succeeds. Real latency/async is modelled by the
 * webhook path (see payments.service.handleWebhook).
 */
export interface ChargeResult {
  status: 'succeeded' | 'failed';
  providerRef: string;
  failureReason?: string;
}

const seen = new Map<string, ChargeResult>(); // in-memory idempotency for the mock

export class PaymentGateway {
  async charge(input: {
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    const cached = seen.get(input.idempotencyKey);
    if (cached) return cached;

    const paise = Math.round((input.amount % 1) * 100);
    const result: ChargeResult =
      paise === 13
        ? { status: 'failed', providerRef: `ch_${randomToken(8)}`, failureReason: 'card_declined' }
        : { status: 'succeeded', providerRef: `ch_${randomToken(8)}` };

    seen.set(input.idempotencyKey, result);
    return result;
  }

  async refund(providerRef: string, _amount: number): Promise<{ status: 'refunded'; refundRef: string }> {
    return { status: 'refunded', refundRef: `rf_${randomToken(8)}_${providerRef.slice(0, 6)}` };
  }
}
