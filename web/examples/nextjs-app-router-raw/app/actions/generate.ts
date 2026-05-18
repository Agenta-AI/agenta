/**
 * Server Action — direct generateText invocation, no API route between
 * the browser and the model.
 *
 * Tests the RSC context-propagation footgun called out in design-doc
 * premise 9: do per-call OTel spans created inside a
 * Server Action correctly attach to the React render context, or do
 * they end up orphaned when Next batches RSC renders?
 *
 * Returns the generated text so the calling Server Component can render
 * the result inline. After the call, force-flushes traces so even a
 * one-shot interaction produces queryable data within the assertion's
 * polling window.
 */

"use server"

import {flushTraces, runGenerateWithTool} from "../lib/ai"

export interface GenerateResult {
    text: string
    runId: string
}

export async function generateAction(formData: FormData): Promise<GenerateResult> {
    const runId = (formData.get("runId") as string | null) ?? `serveraction-${Date.now()}`
    const prompt =
        (formData.get("prompt") as string | null) ??
        "What's the weather in Berlin? Use the getWeather tool."

    const text = await runGenerateWithTool([{role: "user", content: prompt}], {
        userId: runId,
        sessionId: runId,
    })

    await flushTraces()
    return {text, runId}
}
