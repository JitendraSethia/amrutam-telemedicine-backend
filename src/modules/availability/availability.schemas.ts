import { Type } from '@sinclair/typebox';

export const CreateAvailabilityBody = Type.Object(
  {
    slotMinutes: Type.Integer({ minimum: 5, maximum: 240 }),
    blocks: Type.Array(
      Type.Object({
        start: Type.String({ format: 'date-time' }),
        end: Type.String({ format: 'date-time' }),
      }),
      { minItems: 1, maxItems: 50 },
    ),
  },
  { additionalProperties: false },
);

export const CreatedSlotsResponse = Type.Object({ created: Type.Integer() });

export const SlotSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  doctorId: Type.String({ format: 'uuid' }),
  startTs: Type.String({ format: 'date-time' }),
  endTs: Type.String({ format: 'date-time' }),
  status: Type.String(),
});

export const SlotsQuery = Type.Object({
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
});

export const SlotsListResponse = Type.Array(SlotSchema);
