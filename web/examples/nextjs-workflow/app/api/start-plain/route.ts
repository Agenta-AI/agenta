/**
 * Starts the plain-AI-SDK-inside-a-step workflow.
 *
 * `start()` is the canonical Workflow DevKit entry point — it queues the
 * workflow for durable execution and returns a runId immediately.
 */

import {start} from "workflow/api"

import {chatPlainWorkflow} from "../../../workflows/chat-plain"

export async function POST(req: Request): Promise<Response> {
    const runId = req.headers.get("x-agenta-run-id") ?? `wf-plain-${Date.now()}`
    const body = (await req.json().catch(() => ({}))) as {prompt?: string}
    const prompt = body.prompt ?? "Reply with: ok."

    const run = await start(chatPlainWorkflow, [prompt, runId])

    return Response.json({
        runId,
        workflowRunId: run.runId,
    })
}
