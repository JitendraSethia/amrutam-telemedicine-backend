import { pino, type LoggerOptions } from 'pino';

/**
 * Structured JSON logging. Every log line is machine-parseable and enriched
 * with a correlation id (request id / trace id) by Fastify. PII is redacted
 * centrally so we never accidentally log secrets or health data.
 *
 * We export the OPTIONS (not just the instance) so Fastify can build its own
 * logger with the identical config — this keeps Fastify's type generics as
 * `FastifyBaseLogger` while our services share an equivalently-configured
 * standalone `logger`.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-idempotency-key"]',
  '*.password',
  '*.passwordHash',
  '*.mfaSecret',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.ssn',
  '*.email', // emails are PII; log the userId instead
  'res.headers["set-cookie"]',
];

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

export const loggerOptions: LoggerOptions = {
  level,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: {
    service: process.env.OTEL_SERVICE_NAME ?? 'amrutam-telemedicine',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
    : undefined,
};

export const logger = pino(loggerOptions);

export type Logger = typeof logger;
