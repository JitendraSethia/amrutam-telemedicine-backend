import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam } from '../../http/common-schema.js';
import { PaymentSchema, WebhookResponse } from './payments.schemas.js';

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { payments } = app.container;

  r.get(
    '/payments/:id',
    {
      preHandler: [app.authorize('payment:read_own')],
      schema: {
        tags: ['payments'],
        summary: 'Get a payment (owner or admin)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 200: PaymentSchema, ...commonErrors },
      },
    },
    async (req) => payments.getForViewer(req.user!, req.params.id),
  );

  // Provider → us. No user auth; authenticity is proven by the HMAC signature
  // over the raw body. Kept under a generous rate limit but not user-scoped.
  r.post(
    '/payments/webhook',
    {
      config: { public: true, rawBody: true },
      schema: {
        tags: ['payments'],
        summary: 'Payment provider webhook (HMAC-signed, idempotent)',
        response: { 200: WebhookResponse, 401: commonErrors[401] },
      },
    },
    async (req) => {
      const raw = req.rawBody ?? JSON.stringify(req.body ?? {});
      const signature = req.headers['x-signature'] as string | undefined;
      return payments.handleWebhook(raw, signature);
    },
  );
}
