// instrumentation.js
import "dotenv/config";

import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import OpenAI from "openai";

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Get Agenta configuration from environment variables
const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai";
const AGENTA_API_KEY = process.env.AGENTA_API_KEY;

if (!AGENTA_API_KEY) {
    console.error("❌ AGENTA_API_KEY environment variable is required");
    process.exit(1);
}

// Configure the OTLP exporter to send traces to Agenta
const otlpExporter = new OTLPTraceExporter({
    url: `${AGENTA_HOST}/api/otlp/v1/traces`,
    headers: {
        Authorization: `ApiKey ${AGENTA_API_KEY}`,
    },
    timeoutMillis: 5000, // 5 second timeout
});

// Add logging to the exporter for debugging
const originalExport = otlpExporter.export.bind(otlpExporter);
otlpExporter.export = function (spans, resultCallback) {
    console.log(`📤 Exporting ${spans.length} span(s)...`);
    originalExport(spans, (result) => {
        if (result.code === 0) {
            console.log('✅ Spans exported successfully');
        } else {
            console.error('❌ Export failed:', result.error);
        }
        resultCallback(result);
    });
};

// Create and configure the tracer provider
const tracerProvider = new NodeTracerProvider({
    resource: new Resource({
        [ATTR_SERVICE_NAME]: "openai-quickstart",
        // Project name in Agenta, defaults to "default"
        [SEMRESATTRS_PROJECT_NAME]: "openai-quickstart",
    }),
});

// Use SimpleSpanProcessor for immediate export (better for short-lived scripts)
// For long-running services, use: new BatchSpanProcessor(otlpExporter)
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter));

// Register the tracer provider
tracerProvider.register();

// Register OpenAI instrumentation with manual instrumentation
// This is required for OpenInference to properly instrument the OpenAI client
const instrumentation = new OpenAIInstrumentation();
instrumentation.manuallyInstrument(OpenAI);

registerInstrumentations({
    instrumentations: [instrumentation],
});

console.log("✅ OpenTelemetry instrumentation initialized");

