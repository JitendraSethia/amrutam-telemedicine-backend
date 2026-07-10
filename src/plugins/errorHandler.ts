import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { AppError, isAppError } from '../utils/errors.js';

/**
 * Central error handler. Produces a consistent problem envelope:
 *   { error: { code, message, details?, requestId } }
 * - Domain AppErrors map to their status/code.
 * - Fastify schema-validation failures (400) become VALIDATION_ERROR (422).
 * - Postgres unique-violation (23505) surfaces as 409 CONFLICT.
 * - Everything else is a 500 with the message hidden (no internal leakage).
 */
function mapUnknownError(err: FastifyError & { code?: string }): AppError {
  // Fastify/AJV validation error.
  if (err.validation) {
    return new AppError('Request validation failed', {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      details: err.validation.map((v) => ({
        path: v.instancePath || v.schemaPath,
        message: v.message,
      })),
    });
  }
  // Postgres error codes.
  switch (err.code) {
    case '23505': // unique_violation
      return new AppError('Resource already exists', { statusCode: 409, code: 'CONFLICT' });
    case '23503': // foreign_key_violation
      return new AppError('Referenced resource does not exist', {
        statusCode: 409,
        code: 'FK_VIOLATION',
      });
    case '23514': // check_violation
      return new AppError('Value violates a constraint', {
        statusCode: 422,
        code: 'CHECK_VIOLATION',
      });
    case '23P01': // exclusion_violation (overlapping slots)
      return new AppError('Overlaps an existing record', { statusCode: 409, code: 'CONFLICT' });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError('Conflict, please retry', { statusCode: 409, code: 'RETRYABLE_CONFLICT' });
    default:
      break;
  }
  // Body parse / payload too large etc. carry their own statusCode.
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
    return new AppError(err.message, { statusCode: err.statusCode, code: err.code ?? 'BAD_REQUEST' });
  }
  return new AppError('Internal server error', { statusCode: 500, code: 'INTERNAL_ERROR' });
}

export const errorHandlerPlugin = fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    const appErr = isAppError(err) ? err : mapUnknownError(err as FastifyError);

    // Log 5xx at error level with the real error; 4xx at info (expected).
    if (appErr.statusCode >= 500) {
      req.log.error({ err, code: appErr.code }, 'Request failed');
    } else {
      req.log.info({ code: appErr.code, statusCode: appErr.statusCode }, 'Request rejected');
    }

    reply.status(appErr.statusCode).send({
      error: {
        code: appErr.code,
        message: appErr.expose ? appErr.message : 'Internal server error',
        details: appErr.expose ? appErr.details : undefined,
        requestId: req.id,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
    });
  });
});
