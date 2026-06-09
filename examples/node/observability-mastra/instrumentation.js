// instrumentation.js
//
// IDENTICAL to examples/node/observability-vercel-ai/instrumentation.js.
// We use the same setup deliberately, to demonstrate that the
// "raw OTel + global NodeTracerProvider + Agenta OTLP endpoint" pattern
// that works for the Vercel AI SDK does NOT work for Mastra agents.
//
// See README.md for the explanation and the fix.

import "dotenv/config"

import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-proto"
import {resourceFromAttributes} from "@opentelemetry/resources"
import {SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {NodeTracerProvider} from "@opentelemetry/sdk-trace-node"
import {ATTR_SERVICE_NAME} from "@opentelemetry/semantic-conventions"

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY

if (!AGENTA_API_KEY) {
    console.error("AGENTA_API_KEY environment variable is required")
    process.exit(1)
}

const exporter = new OTLPTraceExporter({
    url: `${AGENTA_HOST}/api/otlp/v1/traces`,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
})

const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "mastra-baseline-quickstart",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
})

provider.register()

console.log("OpenTelemetry instrumentation initialized")
console.log("(Note: this baseline does NOT produce Mastra traces — see README)")
