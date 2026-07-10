import { Type } from '@sinclair/typebox';

export const RangeQuery = Type.Object({
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
});

export const OverviewResponse = Type.Object({
  totalConsultations: Type.Integer(),
  byStatus: Type.Record(Type.String(), Type.Integer()),
  revenue: Type.Number(),
  activeDoctors: Type.Integer(),
  newUsers: Type.Integer(),
});

export const TimeSeriesResponse = Type.Array(
  Type.Object({ day: Type.String({ format: 'date-time' }), count: Type.Integer() }),
);

export const TopDoctorsQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10 })),
});

export const TopDoctorsResponse = Type.Array(
  Type.Object({
    doctorId: Type.String({ format: 'uuid' }),
    displayName: Type.String(),
    completed: Type.Integer(),
    ratingAvg: Type.Number(),
  }),
);

export const AuditQuery = Type.Object({
  actorUserId: Type.Optional(Type.String({ format: 'uuid' })),
  resourceType: Type.Optional(Type.String({ maxLength: 60 })),
  resourceId: Type.Optional(Type.String({ maxLength: 100 })),
  action: Type.Optional(Type.String({ maxLength: 100 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  cursor: Type.Optional(Type.String()),
});

export const AuditRecordSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String(),
  actorUserId: Type.Union([Type.String(), Type.Null()]),
  actorRole: Type.Union([Type.String(), Type.Null()]),
  action: Type.String(),
  resourceType: Type.String(),
  resourceId: Type.Union([Type.String(), Type.Null()]),
  outcome: Type.Optional(Type.String()),
  metadata: Type.Unknown(),
  rowHash: Type.String(),
});

export const AuditPageResponse = Type.Object({
  items: Type.Array(AuditRecordSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
