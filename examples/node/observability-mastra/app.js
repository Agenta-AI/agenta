// app.js
//
// Mastra agent quickstart. We register raw OpenTelemetry in
// `instrumentation.js` exactly like the Vercel AI SDK example, then run a
// Mastra agent and try to ship its traces to Agenta.
//
// **EXPECTED RESULT: zero traces in Agenta.**
//
// Read the README for why this happens and where the fix lives. This
// script exists to make the failure mode reproducible — running it gives
// you the empty-Agenta-dashboard experience that motivated the design of
// `@agenta/sdk-mastra`.

import "dotenv/config"

import {openai} from "@ai-sdk/openai"
import {trace} from "@opentelemetry/api"
import {Agent} from "@mastra/core/agent"
import {Mastra} from "@mastra/core/mastra"

const chatAgent = new Agent({
    name: "chat-agent",
    instructions: "You are a helpful assistant. Reply in one short sentence.",
    model: openai("gpt-4o-mini"),
})

// Bare Mastra instance — no `observability` field. This is the simplest
// possible setup, the one a user reaches for after copying the Vercel AI
// SDK example.
new Mastra({agents: {chatAgent}})

async function main() {
    try {
        console.log("Running Mastra agent...")
        const result = await chatAgent.generate(
            "Write a two-sentence story about a robot learning to paint.",
        )
        console.log("\n" + (result.text ?? "(empty)"))

        // Flush all buffered OTel spans before the process exits.
        const tracerProvider = trace.getTracerProvider()
        if (tracerProvider && typeof tracerProvider.forceFlush === "function") {
            await tracerProvider.forceFlush()
        }

        console.log("\nFlush attempted. Check your Agenta dashboard...")
        console.log(
            "Spoiler: nothing arrived. The agent ran successfully but no traces went anywhere.",
        )
        console.log("See README for why + the fix.")
    } catch (err) {
        console.error("Error:", err)
        process.exit(1)
    }
}

await main()
