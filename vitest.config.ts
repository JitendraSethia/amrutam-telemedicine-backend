import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Env required for modules to import (config validation runs at import time).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://amrutam:amrutam@localhost:5432/amrutam_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-123',
      DATA_ENCRYPTION_KEYS:
        'v1:7nlGbE7zD/AEH4/2buLcicBr0O32tHqnD7q9vyz9d5o=,v2:ybErx+ptQ8xJWvOA/OCaywo983OCRYcIXBflDE0AIlQ=',
      DATA_ENCRYPTION_ACTIVE_KID: 'v2',
      PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.types.ts', 'src/index.ts', 'src/observability/tracing.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
