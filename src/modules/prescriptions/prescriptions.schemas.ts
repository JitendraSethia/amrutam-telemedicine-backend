import { Type } from '@sinclair/typebox';

export const MedicationSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  dosage: Type.String({ minLength: 1, maxLength: 100 }),
  frequency: Type.String({ minLength: 1, maxLength: 100 }),
  durationDays: Type.Integer({ minimum: 1, maximum: 365 }),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
});

export const PrescriptionContentSchema = Type.Object({
  medications: Type.Array(MedicationSchema, { minItems: 1, maxItems: 50 }),
  advice: Type.Optional(Type.String({ maxLength: 2000 })),
  followUpInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
});

export const IssuePrescriptionBody = Type.Object(
  {
    consultationId: Type.String({ format: 'uuid' }),
    content: PrescriptionContentSchema,
    supersedesId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
);

export const PrescriptionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  consultationId: Type.String({ format: 'uuid' }),
  doctorId: Type.String({ format: 'uuid' }),
  patientId: Type.String({ format: 'uuid' }),
  content: PrescriptionContentSchema,
  issuedAt: Type.String({ format: 'date-time' }),
  supersedesId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});

export const PrescriptionPageResponse = Type.Object({
  items: Type.Array(PrescriptionSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
