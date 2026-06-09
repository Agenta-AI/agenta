/**
 * Starts the DurableAgent workflow.
 */

import {start} from "workflow/api"

import {chatAgentWorkflow} from "../../../workflows/chat-agent"

export async function POST(req: Request): Promise<Response> {
    const runId = req.headers.get("x-agenta-run-id") ?? `wf-agent-${Date.now()}`
    const body = (await req.json().catch(() => ({}))) as {message?: string}
    const message = body.message ?? "What's the weather in Berlin?"

    const run = await start(chatAgentWorkflow, [message, runId])

    return Response.json({
        runId,
        workflowRunId: run.runId,
    })
}
