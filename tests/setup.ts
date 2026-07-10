// Vitest global setup. Env is injected via vitest.config.ts `test.env`, but we
// set safe fallbacks here too so individual files can be run in isolation.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://amrutam:amrutam@localhost:5432/amrutam_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-123';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-123';
process.env.DATA_ENCRYPTION_KEYS ??=
  'v1:7nlGbE7zD/AEH4/2buLcicBr0O32tHqnD7q9vyz9d5o=,v2:ybErx+ptQ8xJWvOA/OCaywo983OCRYcIXBflDE0AIlQ=';
process.env.DATA_ENCRYPTION_ACTIVE_KID ??= 'v2';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.TRACING_ENABLED ??= 'false';
process.env.LOG_LEVEL ??= 'silent';
