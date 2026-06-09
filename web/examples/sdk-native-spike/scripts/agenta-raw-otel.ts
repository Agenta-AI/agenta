/**
 * Baseline: what AI-SDK + raw OTel users do today.
 * Same chat call as the SDK-native scripts, but no opinionated wrapper.
 *
 * Demonstrates the "60-141 line instrumentation.ts boilerplate" claim from
 * sdk-comparison.md by being roughly that long itself.
 *
 *   #1  setup ergonomics             — count the LoC up to streamText()
 *   #2  auto-trace LLM call          — experimental_telemetry: {isEnabled: true} flag
 *   #3  decorate custom function     — tracer.startActiveSpan + setAttribute
 *   #4  semantic context             — experimental_telemetry.metadata
 *   #6  trace URL helper             — must hand-roll from active span context
 */
import "dotenv/config"
import {trace as otelTrace} from "@opentelemetry/api"
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-proto"
import {resourceFromAttributes} from "@opentelemetry/resources"
import {SimpleSpanProcessor} from "@opentelemetry/sdk-trace-base"
import {NodeTracerProvider} from "@opentelemetry/sdk-trace-node"
import {ATTR_SERVICE_NAME} from "@opentelemetry/semantic-conventions"
import {streamText} from "ai"
import {openai} from "@ai-sdk/openai"

const RUN_ID = `agenta-raw-spike-${Date.now()}`

// ============================================================================
// Row #1 — setup (this whole block is what `init()` would replace)
// ============================================================================
console.log("=".repeat(70))
console.log("ROW #1  Agenta raw OTel setup (count the lines below)")
console.log("=".repeat(70))

const AGENTA_HOST = process.env.AGENTA_HOST || "https://cloud.agenta.ai"
const AGENTA_API_KEY = process.env.AGENTA_API_KEY!
const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID
const otlpUrl = AGENTA_PROJECT_ID
    ? `${AGENTA_HOST}/api/otlp/v1/traces?project_id=${encodeURIComponent(AGENTA_PROJECT_ID)}`
    : `${AGENTA_HOST}/api/otlp/v1/traces`

const exporter = new OTLPTraceExporter({
    url: otlpUrl,
    headers: {Authorization: `ApiKey ${AGENTA_API_KEY}`},
})
const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({[ATTR_SERVICE_NAME]: "sdk-native-spike-agenta-raw"}),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
})
provider.register()
console.log("✓ raw OTel pipeline registered (~12 lines, ignoring imports + comments)")
console.log("  → user must know: SimpleSpanProcessor vs Batch, project_id query param,")
console.log("    ApiKey header shape, ATTR_SERVICE_NAME constant, register() side effect")

// ============================================================================
// Row #2 — auto-trace LLM call via experimental_telemetry flag
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #2  AI SDK experimental_telemetry: {isEnabled: true}")
console.log("=".repeat(70))

const tracer = otelTrace.getTracer("sdk-native-spike")
let traceId = ""

await tracer.startActiveSpan("agenta-raw-spike-root", async (root) => {
    traceId = root.spanContext().traceId

    const result = streamText({
        model: openai("gpt-4o-mini"),
        messages: [{role: "user", content: "Reply with: ok."}],
        experimental_telemetry: {
            isEnabled: true,
            metadata: {
                sdk: "agenta-raw-otel",
                row: "verification",
                runId: RUN_ID,
                // Row #4 — semantic context lives in this metadata bag
                user_id: `user-${RUN_ID}`,
                session_id: `session-${RUN_ID}`,
            },
        },
    })

    let fullText = ""
    for await (const chunk of result.textStream) {
        fullText += chunk
    }
    console.log(`✓ streamText() succeeded with experimental_telemetry flag set`)
    console.log(`  text = "${fullText}"`)
    console.log(`  usage = ${JSON.stringify(await result.usage)}`)

    // ====================================================================
    // Row #3 — decorate custom function (manual span)
    // ====================================================================
    console.log()
    console.log("=".repeat(70))
    console.log("ROW #3  Custom function instrumentation (manual tracer)")
    console.log("=".repeat(70))

    await tracer.startActiveSpan("retrieve-mock", async (span) => {
        span.setAttribute("ag.data.inputs.query", "what is the meaning of life?")
        await new Promise((r) => setTimeout(r, 50))
        span.setAttribute("ag.data.outputs.count", 2)
        span.end()
    })
    console.log("✓ tracer.startActiveSpan() / span.end() pattern")
    console.log("  → no helper for inputs/outputs; user picks attr keys")

    // ====================================================================
    // Row #4 — semantic context (already set above via metadata bag)
    // ====================================================================
    console.log()
    console.log("=".repeat(70))
    console.log("ROW #4  Semantic context via experimental_telemetry.metadata")
    console.log("=".repeat(70))
    console.log("✓ metadata.user_id, metadata.session_id passed inline above.")
    console.log("  → lands as ai.telemetry.metadata.user_id (not ag.user.id)")
    console.log("  → no typed helper; just an untyped bag of key-value pairs")

    // ====================================================================
    // Row #6 — trace URL (HAND ROLLED — this is the spike's empirical claim)
    // ====================================================================
    console.log()
    console.log("=".repeat(70))
    console.log("ROW #6  Trace URL helper — must hand-roll")
    console.log("=".repeat(70))
    const url = `${AGENTA_HOST}/observability/traces/${traceId}`
    console.log(`✓ Hand-rolled URL: ${url}`)
    console.log("  → 1) get tracer 2) startActiveSpan 3) span.spanContext().traceId")
    console.log("     4) format URL with AGENTA_HOST. No built-in helper.")

    root.end()
})

await provider.forceFlush()
console.log()
console.log(`Done. traceId = ${traceId}`)
console.log(`RUN_ID = ${RUN_ID}`)
