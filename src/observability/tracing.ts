import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

/**
 * Distributed tracing via OpenTelemetry. Auto-instruments HTTP, Fastify, pg,
 * ioredis and BullMQ so a single trace spans API → DB → cache → async job.
 * Exported over OTLP/HTTP to an OpenTelemetry Collector (see docker-compose),
 * which fans out to Jaeger/Tempo. Must be started BEFORE the app imports the
 * instrumented libraries, so `index.ts` imports this first.
 */
let sdk: NodeSDK | undefined;

export async function startTracing(): Promise<void> {
  if (process.env.TRACING_ENABLED === 'false') return;

  const exporter = new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]:
        process.env.OTEL_SERVICE_NAME ?? 'amrutam-telemedicine',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? '1.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy and low value.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown().catch(() => undefined);
}
