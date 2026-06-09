/**
 * Workflow variant 1: plain AI SDK inside a `"use step"`.
 *
 * This is the recommended Workflow DevKit pattern — orchestration lives
 * in the `"use workflow"` function, and AI calls live inside steps that
 * have full Node.js access (and therefore see the globally-registered
 * OTel TracerProvider from instrumentation.node.ts).
 *
 * Hypothesis we're verifying:
 *   - Standard `ai.*` / `gen_ai.*` spans land in Agenta from inside the step.
 *   - The user.id metadata we pass via experimental_telemetry is preserved.
 *   - Whether the OTel context propagates from the API route → start() →
 *     workflow → step (all-in-one trace), or whether each segment is a
 *     fresh trace.
 */

import {openai} from "@ai-sdk/openai"
import {generateText} from "ai"

/**
 * Step function — full Node.js access, OTel applies normally.
 */
async function callOpenAI(prompt: string, runId: string): Promise<{text: string; usage: unknown}> {
    "use step"
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
        experimental_telemetry: {
            isEnabled: true,
            functionId: "workflow-plain-step",
            metadata: {
                userId: runId,
                sessionId: runId,
            },
        },
    })
    return {text: result.text, usage: result.usage}
}

/**
 * Workflow function — sandboxed VM. No fetch, no Node modules. Pure
 * orchestration. We pass `runId` through to the step so the per-call
 * telemetry metadata reaches the AI SDK boundary.
 */
export async function chatPlainWorkflow(prompt: string, runId: string): Promise<{
    text: string
    usage: unknown
}> {
    "use workflow"
    return await callOpenAI(prompt, runId)
}
