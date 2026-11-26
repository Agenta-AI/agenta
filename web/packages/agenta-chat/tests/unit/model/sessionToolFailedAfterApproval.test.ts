/**
 * A session tool call that fails after the person approved it keeps its failed row. The approval
 * renames the call from the record's `mcp.agenta-tools.start_session` to the gate's
 * `start_session`, and the row must not depend on which of the two names the part carries.
 */
import type {SessionRecord} from "@agenta/entities/session"
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"
import {splitTurnActivity} from "../../../src/model/activitySteps"
import {partToolName} from "../../../src/model/parts"
import {buildTurnRenderItems, executedToolIdentities} from "../../../src/model/renderModel"

const CALL_ID = "exec-148333aa"
const INTERACTION_ID = "d9ce38d4"
const ARGS = {name: "chain 0", text: "chain 0", agent: "r3-relay", wait_ms: 60000}
const REFUSAL =
    "tool call tools.agenta.start_session failed: This session is 3 levels below the session " +
    'that a person started.\n{"code":"session_depth_limit_reached","retryable":false}'

const record = (id: string, turnId: string, payload: Record<string, unknown>): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    event_index: null,
    sender: "agent",
    session_update: String(payload.type),
    payload,
    turn_id: turnId,
    created_at: null,
})

/** The records of a start that asked, was approved, and then failed, in stored order. */
const approvedThenFailed = (failed: boolean): SessionRecord[] => [
    record("1", "paused", {
        type: "tool_call",
        id: CALL_ID,
        name: "mcp.agenta-tools.start_session",
        input: {tool: "start_session", server: "agenta-tools", arguments: ARGS},
    }),
    record("2", "paused", {
        type: "interaction_request",
        id: INTERACTION_ID,
        kind: "user_approval",
        payload: {
            toolCallId: CALL_ID,
            toolCall: {
                kind: "execute",
                status: "pending",
                rawInput: ARGS,
                toolCallId: CALL_ID,
                resolvedName: "start_session",
            },
        },
    }),
    record("3", "paused", {type: "done", stopReason: "paused"}),
    // The resume stores the re-emitted call (under the bare name) before the answer.
    record("4", "resumed", {
        type: "tool_call",
        id: CALL_ID,
        name: "start_session",
        input: {tool: "start_session", server: "agenta-tools", arguments: ARGS},
    }),
    record("5", "resumed", {
        type: "interaction_response",
        id: INTERACTION_ID,
        kind: "user_approval",
        payload: {approved: true, toolCallId: CALL_ID},
    }),
    record("6", "resumed", {
        type: "tool_result",
        id: CALL_ID,
        output: failed ? REFUSAL : "[Update from child session s (R3 Relay). ...]",
        isError: failed,
    }),
    record("7", "resumed", {type: "done"}),
]

const foldedToolSteps = (records: SessionRecord[]): ToolUIPart[] => {
    const messages = transcriptToMessages(records) ?? []
    const assistant = messages.find((message) => message.role === "assistant")
    expect(assistant).toBeDefined()
    const parts = assistant!.parts
    const items = buildTurnRenderItems(parts, {
        executed: executedToolIdentities(parts),
        isClientToolPart: () => false,
    })
    return splitTurnActivity(items, {settled: true}).steps.flatMap((step) =>
        step.kind === "tool" ? [step.part] : [],
    )
}

describe("a session tool call that fails after its approval", () => {
    it("keeps one failed step for the call", () => {
        const steps = foldedToolSteps(approvedThenFailed(true))
        expect(steps).toHaveLength(1)
        expect(steps[0].toolCallId).toBe(CALL_ID)
        expect(steps[0].state).toBe("output-error")
        // The approval renamed it: the step no longer carries the record's MCP name.
        expect(partToolName(steps[0])).toBe("start_session")
    })

    it("keeps the step of an approved call that ran", () => {
        const steps = foldedToolSteps(approvedThenFailed(false))
        expect(steps).toHaveLength(1)
        expect(steps[0].state).toBe("output-available")
    })
})

describe("the fold keeps a failed session tool call under either name", () => {
    const failedStep = (type: string): ToolUIPart =>
        ({
            type,
            toolCallId: "c1",
            state: "output-error",
            input: ARGS,
            errorText: REFUSAL,
        }) as unknown as ToolUIPart

    it.each([
        "tool-start_session",
        "tool-mcp.agenta-tools.start_session",
        "tool-mcp__agenta-tools__start_session",
        "tool-send_session_message",
    ])("keeps %s", (type) => {
        const split = splitTurnActivity([{kind: "tools", index: 0, parts: [failedStep(type)]}])
        expect(split.steps).toHaveLength(1)
    })

    it("still hides a failed call of a tool that does not word its failure", () => {
        const split = splitTurnActivity([
            {kind: "tools", index: 0, parts: [failedStep("tool-read_config")]},
        ])
        expect(split.steps).toHaveLength(0)
    })
})
