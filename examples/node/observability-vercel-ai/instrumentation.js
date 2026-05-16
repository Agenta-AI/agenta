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
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com";

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

// Optional Langfuse tri-export. Same OTel data fans out to a third backend so
// you can compare what each platform displays for IDENTICAL trace input. Auth
// is Basic base64(LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY) per their OTel docs
// (https://langfuse.com/docs/opentelemetry/get-started). Leave keys unset to
// disable.
if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
    const auth = Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString("base64");
    const langfuseExporter = new OTLPTraceExporter({
        url: `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
        headers: {
            Authorization: `Basic ${auth}`,
            "x-langfuse-ingestion-version": "4",
        },
    });
    spanProcessors.push(new SimpleSpanProcessor(langfuseExporter));
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
if (LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY) {
    console.log(`+ Langfuse tri-export → ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`);
}
