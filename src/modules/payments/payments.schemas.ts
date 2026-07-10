import { Type } from '@sinclair/typebox';

export const PaymentSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  consultationId: Type.String({ format: 'uuid' }),
  amount: Type.Number(),
  currency: Type.String(),
  status: Type.String(),
  refundedAmount: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
});

export const WebhookResponse = Type.Object({ received: Type.Boolean() });
