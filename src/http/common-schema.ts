import { Type } from '@sinclair/typebox';

/** Standard error envelope emitted by the global error handler. */
export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
      requestId: Type.Optional(Type.String()),
    }),
  },
  { $id: 'ErrorResponse' },
);

export const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) });

/** Advertises the required Idempotency-Key header on write endpoints. */
export const IdempotencyHeader = Type.Object({
  'idempotency-key': Type.String({
    minLength: 8,
    maxLength: 200,
    description: 'Client-generated unique key that makes this write idempotent.',
  }),
});

export const PaginationQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: Type.Optional(Type.String()),
});

/** Common error responses reused across routes. */
export const commonErrors = {
  400: Type.Ref(ErrorResponse),
  401: Type.Ref(ErrorResponse),
  403: Type.Ref(ErrorResponse),
  404: Type.Ref(ErrorResponse),
  409: Type.Ref(ErrorResponse),
  422: Type.Ref(ErrorResponse),
  429: Type.Ref(ErrorResponse),
};
