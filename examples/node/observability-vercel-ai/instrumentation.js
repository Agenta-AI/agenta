// instrumentation.js
import "dotenv/config";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai";
const AGENTA_API_KEY = process.env.AGENTA_API_KEY;
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY;
const BRAINTRUST_OTLP_URL =
    process.env.BRAINTRUST_OTLP_URL || "https://api.braintrust.dev/otel/v1/traces";

if (!AGENTA_API_KEY) {
    console.error("AGENTA_API_KEY environment variable is required");
    process.exit(1);
}

const SERVICE_NAME = "vercel-ai-quickstart";

const agentaExporter = new OTLPTraceExporter({
    url: `${AGENTA_HOST}/api/otlp/v1/traces`,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
});

// Optional Braintrust dual-export. Same OTel data fans out to both backends so
// you can compare what each platform displays for IDENTICAL trace input. Leave
// BRAINTRUST_API_KEY unset to disable.
const spanProcessors = [new SimpleSpanProcessor(agentaExporter)];

if (BRAINTRUST_API_KEY) {
    const braintrustExporter = new OTLPTraceExporter({
        url: BRAINTRUST_OTLP_URL,
        headers: {
            Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
            "x-bt-parent": `project_name:${SERVICE_NAME}`,
        },
    });
    spanProcessors.push(new SimpleSpanProcessor(braintrustExporter));
}

const provider = new NodeTracerProvider({
    resource: new Resource({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
    }),
    spanProcessors,
});

provider.register();

console.log("OpenTelemetry instrumentation initialized");
if (BRAINTRUST_API_KEY) {
    console.log(`+ Braintrust dual-export → ${BRAINTRUST_OTLP_URL}`);
}
