import { Type } from '@sinclair/typebox';

export const ConsultationSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  patientId: Type.String({ format: 'uuid' }),
  doctorId: Type.String({ format: 'uuid' }),
  slotId: Type.String({ format: 'uuid' }),
  status: Type.String(),
  mode: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  scheduledStart: Type.String({ format: 'date-time' }),
  scheduledEnd: Type.String({ format: 'date-time' }),
  startedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  endedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  cancellationReason: Type.Union([Type.String(), Type.Null()]),
  feeAmount: Type.Number(),
  currency: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export const ConsultationPageResponse = Type.Object({
  items: Type.Array(ConsultationSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

export const ConsultationListQuery = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('pending_payment'),
      Type.Literal('scheduled'),
      Type.Literal('in_progress'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
      Type.Literal('no_show'),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: Type.Optional(Type.String()),
});

export const CancelBody = Type.Object(
  { reason: Type.String({ minLength: 3, maxLength: 500 }) },
  { additionalProperties: false },
);

export const NotesBody = Type.Object(
  { notes: Type.String({ minLength: 1, maxLength: 10000 }) },
  { additionalProperties: false },
);

export const ReviewBody = Type.Object(
  {
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    comment: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);
