import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { logs } from "@opentelemetry/api-logs";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { metrics } from "@opentelemetry/api";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";

const collectorUrl =
  import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ??
  "http://localhost:4318";

const resource = new Resource({
  [ATTR_SERVICE_NAME]: "frontend",
});

// ---- Traces ----
const traceExporter = new OTLPTraceExporter({
  url: `${collectorUrl}/v1/traces`,
});
const tracerProvider = new WebTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
});
tracerProvider.register({
  contextManager: new ZoneContextManager(),
});

// ---- Metrics ----
const metricExporter = new OTLPMetricExporter({
  url: `${collectorUrl}/v1/metrics`,
});
const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10_000,
    }),
  ],
});
metrics.setGlobalMeterProvider(meterProvider);

// ---- Logs ----
const logExporter = new OTLPLogExporter({
  url: `${collectorUrl}/v1/logs`,
});
const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
logs.setGlobalLoggerProvider(loggerProvider);

// ---- 自動計装 ----
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
    new DocumentLoadInstrumentation(),
  ],
});

// ---- エクスポート: TodoList から使うメーター ----
export const meter = metrics.getMeter("frontend");
export const logger = logs.getLogger("frontend");
