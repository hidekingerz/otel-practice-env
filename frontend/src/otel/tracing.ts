import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";

const collectorUrl =
  import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ??
  "http://localhost:4318";

const exporter = new OTLPTraceExporter({
  url: `${collectorUrl}/v1/traces`,
});

const provider = new WebTracerProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "frontend",
  }),
  spanProcessors: [new BatchSpanProcessor(exporter)],
});

provider.register({
  contextManager: new ZoneContextManager(),
});

registerInstrumentations({
  instrumentations: [
    // fetch API を自動計装 → traceparent ヘッダーを付与してバックエンドと繋ぐ
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
    }),
    // ページロードを自動計装
    new DocumentLoadInstrumentation(),
  ],
});
