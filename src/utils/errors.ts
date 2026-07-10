/**
 * Domain error hierarchy. Every error carries a stable machine-readable
 * `code`, an HTTP `statusCode`, and an optional `details` payload. The global
 * error handler turns these into RFC-7807-ish problem responses and never
 * leaks internals (stack traces, SQL) to clients.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(
    message: string,
    opts: { statusCode?: number; code?: string; details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? 'INTERNAL_ERROR';
    this.details = opts.details;
    // 5xx are never exposed verbatim; 4xx are safe to show.
    this.expose = opts.expose ?? this.statusCode < 500;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, { statusCode: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions', details?: unknown) {
    super(message, { statusCode: 403, code: 'FORBIDDEN', details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT', details?: unknown) {
    super(message, { statusCode: 409, code, details });
  }
}

/** Optimistic-concurrency / slot-already-taken style conflicts. */
export class SlotUnavailableError extends ConflictError {
  constructor(message = 'The requested slot is no longer available') {
    super(message, 'SLOT_UNAVAILABLE');
  }
}

/** Raised when an Idempotency-Key is reused with a different request body. */
export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super(
      'Idempotency-Key was reused with a different request payload',
      'IDEMPOTENCY_KEY_REUSE',
    );
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(message, {
      statusCode: 429,
      code: 'RATE_LIMITED',
      details: retryAfterSeconds ? { retryAfterSeconds } : undefined,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, { statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
