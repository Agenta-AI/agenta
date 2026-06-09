/**
 * Empirical verification of braintrust JS SDK ergonomics.
 * Targets rows #2, #3, #4, #6 of the sdk-comparison.md table.
 *
 *   #1  setup ergonomics             — initLogger() + wrapAISDK() (2 lines)
 *   #2  auto-trace LLM call          — wrapAISDK / wrapOpenAI drop-in
 *   #3  decorate custom function     — traced(fn, options) functional wrapper
 *   #4  semantic context             — currentSpan().log({metadata, tags})
 *   #6  trace URL helper             — currentSpan().link()
 */
import "dotenv/config"
import {initLogger, wrapAISDK, traced, currentSpan} from "braintrust"
import * as ai from "ai"
import {openai} from "@ai-sdk/openai"

const RUN_ID = `braintrust-spike-${Date.now()}`

// ============================================================================
// Row #1 — setup
// ============================================================================
console.log("=".repeat(70))
console.log("ROW #1  Braintrust setup ergonomics")
console.log("=".repeat(70))

// initLogger reads BRAINTRUST_API_KEY, BRAINTRUST_API_URL (for EU plane), etc.
initLogger({
    projectName: process.env.BRAINTRUST_PROJECT_NAME || "sdk-native-spike",
    apiKey: process.env.BRAINTRUST_API_KEY,
    appUrl: process.env.BRAINTRUST_APP_URL,
})
console.log("✓ initLogger() called (1 statement)")

// wrapAISDK wraps the entire `ai` namespace; subsequent ai.streamText etc. are auto-traced
const tracedAI = wrapAISDK(ai)
console.log("✓ wrapAISDK(ai) → returns wrapped namespace")

// ============================================================================
// Row #2 — auto-trace LLM call (no experimental_telemetry flag needed)
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #2  wrapAISDK drop-in — no experimental_telemetry flag needed")
console.log("=".repeat(70))

await traced(
    async (span) => {
        // wrapAISDK pattern: just call the wrapped streamText directly
        const result = tracedAI.streamText({
            model: openai("gpt-4o-mini"),
            messages: [{role: "user", content: "Reply with: ok."}],
        })

        let fullText = ""
        for await (const chunk of result.textStream) {
            fullText += chunk
        }

        console.log(`✓ wrapped ai.streamText() succeeded`)
        console.log(`  text = "${fullText}"`)
        console.log(`  usage = ${JSON.stringify(await result.usage)}`)
        console.log("  → no experimental_telemetry.isEnabled needed")

        // ====================================================================
        // Row #3 — decorate custom function via traced()
        // ====================================================================
        console.log()
        console.log("=".repeat(70))
        console.log("ROW #3  Custom function instrumentation via traced()")
        console.log("=".repeat(70))

        await traced(
            async (innerSpan) => {
                innerSpan.log({input: {query: "what is the meaning of life?"}})
                await new Promise((r) => setTimeout(r, 50))
                innerSpan.log({output: {docs: ["doc-1", "doc-2"], count: 2}})
            },
            {name: "retrieve-mock"},
        )
        console.log("✓ traced(fn, {name}) wrapper works")
        console.log("  → currentSpan().log({input, output}) inside")

        // ====================================================================
        // Row #4 — semantic context via currentSpan().log()
        // ====================================================================
        console.log()
        console.log("=".repeat(70))
        console.log("ROW #4  Semantic context via currentSpan().log()")
        console.log("=".repeat(70))
        span.log({
            metadata: {sdk: "braintrust", row: "verification", runId: RUN_ID},
            tags: ["spike", "sdk-comparison"],
        })
        console.log("✓ currentSpan().log({metadata, tags}) — flat KV")
        console.log("  → no first-class userId/sessionId field (use metadata.user_id convention)")

        // ====================================================================
        // Row #6 — trace URL helper
        // ====================================================================
        console.log()
        console.log("=".repeat(70))
        console.log("ROW #6  Trace URL helper")
        console.log("=".repeat(70))
        const link = await currentSpan().link()
        console.log(`✓ currentSpan().link() returned: ${link}`)
    },
    {name: "braintrust-sdk-spike-root"},
)

// Make sure spans flush before process exit
console.log()
console.log(`Done. RUN_ID = ${RUN_ID}`)
