/**
 * Pins a PRE-EXISTING platform hazard. This is characterization, not a fix, and not the fix for
 * the bug that exposed it.
 *
 * Found while investigating a gateway `run_tool` approval that left the button loading and sent no
 * HTTP request at all. Root cause turned out to be runner-side: the gateway park held the run
 * stream open for the whole relay timeout (measured 59 to 135 seconds, against about 50ms for the
 * two working pause kinds), the client's timeout error then appended an empty assistant carrier,
 * and the carrier is what pushed the approval out of the last message. The runner unblocks the
 * relay wait on park; nothing here changes.
 *
 * What this file pins is the hazard that turned that timeout into a dead card, which outlives that
 * fix: the dock OFFERS approvals the SDK's responder can never REACH.
 *
 * Two scans disagree about scope:
 *   - `getPendingApprovals` (ours) walks EVERY assistant message. #5919 widened it on purpose,
 *     because a card parked several turns up still holds the gate.
 *   - `addToolApprovalResponse` (the AI SDK, ai@6.0.0-beta.150) rewrites ONLY
 *     `messages[messages.length - 1]`, then asks `sendAutomaticallyWhen` whether to resume.
 *
 * So any approval the dock surfaces from a non-last message is a dead card: clicking it updates
 * nothing, the part stays `approval-requested`, the resume predicate finds no `approval-responded`,
 * and no HTTP request is ever made — button stuck loading, zero network activity, row stuck on
 * "Awaiting approval". Any future path that lands an approval behind a later message reopens it.
 *
 * `applySdkApprovalResponse` below mirrors the SDK's update verbatim so the gap is executable here
 * without reaching into `ai` internals. If the SDK's scope ever widens, the last two tests flip and
 * this file should be revisited.
 */
import {agentShouldResumeAfterApproval} from "@agenta/playground/state"
import {describe, expect, it} from "vitest"

import {getPendingApprovals} from "../../../src/model/approvals"

type TestMessage = {id: string; role: string; parts: Record<string, unknown>[]}

const approvalPart = (approvalId: string, toolCallId: string) => ({
    type: "tool-run_tool",
    toolCallId,
    state: "approval-requested",
    approval: {id: approvalId},
    input: {integration: "github", tool: "CREATE_ISSUE"},
})

const assistant = (id: string, parts: Record<string, unknown>[]): TestMessage => ({
    id,
    role: "assistant",
    parts,
})

/** The AI SDK's `addToolApprovalResponse`, reduced to its matching rule: last message only. */
function applySdkApprovalResponse(
    messages: TestMessage[],
    {id, approved}: {id: string; approved: boolean},
): TestMessage[] {
    if (messages.length === 0) return messages
    const last = messages[messages.length - 1]
    const parts = (last.parts ?? []).map((part) => {
        const type = part.type
        const isTool =
            typeof type === "string" && (type.startsWith("tool-") || type === "dynamic-tool")
        const approval = part.approval as {id?: string} | undefined
        return isTool && part.state === "approval-requested" && approval?.id === id
            ? {...part, state: "approval-responded", approval: {id, approved}}
            : part
    })
    const next = messages.slice()
    next[next.length - 1] = {...last, parts}
    return next
}

/** An approval parked in an earlier message, with the empty assistant carrier the run-error
 *  effect appends after a failed turn sitting behind it. */
const parkedBehindCarrier = (): TestMessage[] => [
    assistant("m1", [approvalPart("appr-1", "call-1")]),
    assistant("m2", []),
]

describe("the dock's scan is wider than the SDK's responder", () => {
    it("offers an approval that lives in a non-last message", () => {
        const offered = getPendingApprovals(parkedBehindCarrier() as never)
        expect(offered.map((approval) => approval.approvalId)).toEqual(["appr-1"])
    })

    it("but responding to it updates nothing, so the part stays approval-requested", () => {
        const next = applySdkApprovalResponse(parkedBehindCarrier(), {
            id: "appr-1",
            approved: true,
        })
        expect(next[0].parts[0].state).toBe("approval-requested")
    })

    it("so the resume never fires: no HTTP request, card stuck loading", () => {
        const next = applySdkApprovalResponse(parkedBehindCarrier(), {
            id: "appr-1",
            approved: true,
        })
        expect(
            agentShouldResumeAfterApproval({
                messages: next,
                liveInteraction: {kind: "approval", id: "appr-1"},
            }),
        ).toBe(false)
    })

    it("the same approval in the LAST message responds and resumes — the built-in's path", () => {
        const messages = [assistant("m1", [approvalPart("appr-1", "call-1")])]
        const next = applySdkApprovalResponse(messages, {id: "appr-1", approved: true})
        expect(next[0].parts[0].state).toBe("approval-responded")
        expect(
            agentShouldResumeAfterApproval({
                messages: next,
                liveInteraction: {kind: "approval", id: "appr-1"},
            }),
        ).toBe(true)
    })
})
