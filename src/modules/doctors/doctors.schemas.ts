import { Type } from '@sinclair/typebox';

export const SpecializationSchema = Type.Object({
  id: Type.Integer(),
  slug: Type.String(),
  name: Type.String(),
});

export const DoctorProfileSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  bio: Type.Union([Type.String(), Type.Null()]),
  yearsExperience: Type.Integer(),
  consultationFee: Type.Number(),
  currency: Type.String(),
  languages: Type.Array(Type.String()),
  ratingAvg: Type.Number(),
  ratingCount: Type.Integer(),
  isVerified: Type.Boolean(),
  isAccepting: Type.Boolean(),
  timezone: Type.String(),
  specializations: Type.Array(SpecializationSchema),
});

export const DoctorSearchQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100 })),
  specialization: Type.Optional(Type.String({ maxLength: 60 })),
  minRating: Type.Optional(Type.Number({ minimum: 0, maximum: 5 })),
  maxFee: Type.Optional(Type.Number({ minimum: 0 })),
  language: Type.Optional(Type.String({ maxLength: 40 })),
  sort: Type.Optional(
    Type.Union([Type.Literal('rating'), Type.Literal('fee'), Type.Literal('experience')]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  cursor: Type.Optional(Type.String()),
});

export const DoctorPageResponse = Type.Object({
  items: Type.Array(DoctorProfileSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

export const CreateDoctorProfileBody = Type.Object(
  {
    displayName: Type.String({ minLength: 2, maxLength: 120 }),
    bio: Type.Optional(Type.String({ maxLength: 2000 })),
    yearsExperience: Type.Integer({ minimum: 0, maximum: 80 }),
    consultationFee: Type.Number({ minimum: 0, maximum: 1000000 }),
    languages: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 20, default: [] }),
    specializationSlugs: Type.Array(Type.String({ maxLength: 60 }), { maxItems: 20, default: [] }),
  },
  { additionalProperties: false },
);

export const UpdateDoctorProfileBody = Type.Object(
  {
    bio: Type.Optional(Type.String({ maxLength: 2000 })),
    consultationFee: Type.Optional(Type.Number({ minimum: 0, maximum: 1000000 })),
    languages: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 20 })),
    isAccepting: Type.Optional(Type.Boolean()),
    timezone: Type.Optional(Type.String({ maxLength: 60 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
