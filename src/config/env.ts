import 'dotenv/config';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * Centralised, validated configuration. The process refuses to boot if the
 * environment is invalid — fail fast rather than crash under load.
 * All secrets arrive via environment variables (12-factor); nothing is
 * hard-coded. In production these are sourced from a secrets manager.
 */
const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  APP_NAME: Type.String({ default: 'amrutam-telemedicine' }),
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Number({ default: 8080 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  CORS_ORIGINS: Type.String({ default: '' }),

  DATABASE_URL: Type.String(),
  DATABASE_REPLICA_URL: Type.Optional(Type.String()),
  PGPOOL_MAX: Type.Number({ default: 20 }),
  PGPOOL_IDLE_TIMEOUT_MS: Type.Number({ default: 30000 }),
  PGPOOL_CONN_TIMEOUT_MS: Type.Number({ default: 5000 }),

  REDIS_URL: Type.String({ default: 'redis://localhost:6379' }),

  JWT_ACCESS_SECRET: Type.String({ minLength: 16 }),
  JWT_REFRESH_SECRET: Type.String({ minLength: 16 }),
  JWT_ACCESS_TTL: Type.Number({ default: 900 }),
  JWT_REFRESH_TTL: Type.Number({ default: 1209600 }),
  JWT_ISSUER: Type.String({ default: 'amrutam.auth' }),
  JWT_AUDIENCE: Type.String({ default: 'amrutam.api' }),

  DATA_ENCRYPTION_KEYS: Type.String(),
  DATA_ENCRYPTION_ACTIVE_KID: Type.String(),

  MFA_ISSUER: Type.String({ default: 'Amrutam Telemedicine' }),

  RATE_LIMIT_MAX: Type.Number({ default: 100 }),
  RATE_LIMIT_WINDOW: Type.String({ default: '1 minute' }),

  IDEMPOTENCY_TTL_SECONDS: Type.Number({ default: 86400 }),

  OTEL_EXPORTER_OTLP_ENDPOINT: Type.String({ default: 'http://localhost:4318' }),
  OTEL_SERVICE_NAME: Type.String({ default: 'amrutam-telemedicine' }),
  METRICS_ENABLED: Type.Boolean({ default: true }),
  TRACING_ENABLED: Type.Boolean({ default: true }),

  PAYMENT_WEBHOOK_SECRET: Type.String({ default: 'change-me-webhook-secret' }),
  PAYMENT_PROVIDER_BASE_URL: Type.String({ default: 'http://localhost:9099' }),

  SLOT_HOLD_TTL_SECONDS: Type.Number({ default: 300 }),
});

function coerce(raw: NodeJS.ProcessEnv): Record<string, unknown> {
  // TypeBox needs numbers/booleans as native types; env vars are strings.
  const out: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(EnvSchema.properties)) {
    const prop = (EnvSchema.properties as Record<string, { type?: string }>)[key];
    const val = raw[key];
    if (val === undefined || val === '') continue;
    if (prop.type === 'number') out[key] = Number(val);
    else if (prop.type === 'boolean') out[key] = val === 'true' || val === '1';
  }
  return out;
}

function loadEnv() {
  const coerced = Value.Default(EnvSchema, coerce(process.env)) as Record<string, unknown>;
  const errors = [...Value.Errors(EnvSchema, coerced)];
  if (errors.length > 0) {
    const summary = errors
      .map((e) => `  - ${e.path || '(root)'}: ${e.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${summary}`);
    process.exit(1);
  }
  return Value.Decode(EnvSchema, coerced);
}

export type AppEnv = ReturnType<typeof loadEnv>;

export const env: AppEnv = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export function corsOrigins(): string[] | boolean {
  if (!env.CORS_ORIGINS) return false;
  if (env.CORS_ORIGINS === '*') return true;
  return env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
}
