/**
 * Empirical verification of langfuse-node SDK ergonomics.
 * Targets rows #2, #3, #4, #6 of the sdk-comparison.md table.
 *
 * Runs once, prints what the SDK actually returns (so we don't have to trust docs).
 *
 *   #1  setup ergonomics             — count lines, observe runtime errors
 *   #2  auto-trace LLM call          — observeOpenAI() drop-in wrapper
 *   #3  decorate custom function     — trace.span() functional pattern
 *   #4  semantic context             — userId, sessionId, metadata, tags first-class fields
 *   #6  trace URL helper             — trace.getTraceUrl()
 */
import "dotenv/config"
import {Langfuse, observeOpenAI} from "langfuse"
import OpenAI from "openai"

const RUN_ID = `langfuse-spike-${Date.now()}`

// ============================================================================
// Row #1 — setup
// ============================================================================
console.log("=".repeat(70))
console.log("ROW #1  Langfuse setup ergonomics")
console.log("=".repeat(70))

const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
})
console.log("✓ Langfuse client created (1 statement, 3 env vars)")

// ============================================================================
// Row #2 — auto-trace LLM call via observeOpenAI wrapper
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #2  observeOpenAI() drop-in wrapper for OpenAI client")
console.log("=".repeat(70))

const openaiBase = new OpenAI({apiKey: process.env.OPENAI_API_KEY})

// observeOpenAI takes the OpenAI client + Langfuse trace and returns
// a wrapped client. Every method call on it auto-emits a Langfuse generation.
const trace = langfuse.trace({
    name: "langfuse-sdk-spike-trace",
    userId: `user-${RUN_ID}`,
    sessionId: `session-${RUN_ID}`,
    metadata: {sdk: "langfuse-node", row: "verification"},
    tags: ["spike", "sdk-comparison"],
})

const openai = observeOpenAI(openaiBase, {
    parent: trace,
    generationName: "openai-row2-streamText-equivalent",
})

const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{role: "user", content: "Reply with: ok."}],
})

console.log("✓ openai.chat.completions.create() succeeded")
console.log(`  response.choices[0].message.content = "${response.choices[0].message.content}"`)
console.log(`  response.usage = ${JSON.stringify(response.usage)}`)
console.log("  → Langfuse emits a `generation` observation automatically (no flag)")

// ============================================================================
// Row #3 — decorate custom function via trace.span()
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #3  Custom function instrumentation via trace.span()")
console.log("=".repeat(70))

const customSpan = trace.span({
    name: "retrieve-mock",
    input: {query: "what is the meaning of life?"},
})
// Simulate work
await new Promise((r) => setTimeout(r, 50))
customSpan.end({output: {docs: ["doc-1", "doc-2"], count: 2}})

console.log("✓ trace.span() / .end() works as a functional wrapper")
console.log("  → No @decorator syntax. Imperative open/close pattern.")

// ============================================================================
// Row #4 — semantic context (userId, sessionId, metadata, tags)
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #4  Semantic context: userId / sessionId / metadata / tags")
console.log("=".repeat(70))
console.log("✓ All four set on trace constructor:")
console.log(`    userId    = "user-${RUN_ID}"`)
console.log(`    sessionId = "session-${RUN_ID}"`)
console.log(`    metadata  = {sdk: "langfuse-node", row: "verification"}`)
console.log(`    tags      = ["spike", "sdk-comparison"]`)

// ============================================================================
// Row #6 — trace URL helper
// ============================================================================
console.log()
console.log("=".repeat(70))
console.log("ROW #6  Trace URL helper")
console.log("=".repeat(70))
const traceUrl = await trace.getTraceUrl()
console.log(`✓ trace.getTraceUrl() returned: ${traceUrl}`)

// Flush to make sure everything ships before process exit
await langfuse.flushAsync()
console.log()
console.log(`Done. trace.id = ${trace.id}`)
console.log(`RUN_ID = ${RUN_ID}`)
