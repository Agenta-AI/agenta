// instrumentation.js
import "dotenv/config";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai";
const AGENTA_API_KEY = process.env.AGENTA_API_KEY;

if (!AGENTA_API_KEY) {
    console.error("AGENTA_API_KEY environment variable is required");
    process.exit(1);
}

// Send traces to Agenta's OTLP endpoint
const exporter = new OTLPTraceExporter({
    url: `${AGENTA_HOST}/api/otlp/v1/traces`,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
});

const provider = new NodeTracerProvider({
    resource: new Resource({
        [ATTR_SERVICE_NAME]: "vercel-ai-quickstart",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
});

provider.register();

console.log("OpenTelemetry instrumentation initialized");
