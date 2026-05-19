/**
 * Workflow variant 2: `DurableAgent` from @workflow/ai.
 *
 * DurableAgent is Workflow DevKit's prescribed pattern for AI agents
 * inside workflows. It handles the workflow sandbox limitations
 * automatically (reassigns `globalThis.fetch` from workflow's primitive
 * so AI SDK can run inside the `"use workflow"` context).
 *
 * Setup per the official DurableAgent docs:
 *   - Use `instructions` (not `system`).
 *   - Use a model object from `@workflow/ai/<provider>` (here: openai),
 *     not a "provider/model" string (those go through Vercel Gateway).
 *   - `workflow` + `@workflow/ai` must NOT be in next.config's
 *     `serverExternalPackages` — see the comment in next.config.ts.
 *
 * Hypothesis we're verifying:
 *   - DurableAgent produces standard `ai.*` / `gen_ai.*` spans (it
 *     wraps AI SDK internally — the underlying generateText/streamText
 *     should be visible to OTel).
 *   - The internal `globalThis.fetch` reassignment doesn't break the
 *     OTLP HTTP exporter — instrumented spans should still export.
 *   - Multi-step agent runs (LLM call → tool → LLM call) all share
 *     one trace.
 */

import {DurableAgent} from "@workflow/ai/agent"
import {openai} from "@workflow/ai/openai"
import {getWritable} from "workflow"
import {z} from "zod"
import type {UIMessageChunk} from "ai"

/**
 * Simple tool the agent can use. Marked as a step so it has Node access.
 */
async function getWeather({location}: {location: string}): Promise<string> {
    "use step"
    return `The weather in ${location} is sunny and 72°F.`
}

export async function chatAgentWorkflow(userMessage: string, runId: string): Promise<unknown> {
    "use workflow"

    const agent = new DurableAgent({
        model: openai("gpt-4o-mini"),
        instructions:
            "You are a helpful assistant. Use the getWeather tool if asked about weather.",
        tools: {
            getWeather: {
                description: "Get current weather for a location.",
                inputSchema: z.object({location: z.string()}),
                execute: getWeather,
            },
        },
    })

    const result = await agent.stream({
        messages: [{role: "user", content: userMessage}],
        writable: getWritable<UIMessageChunk>(),
    })

    return {
        runId,
        messages: result.messages,
    }
}
