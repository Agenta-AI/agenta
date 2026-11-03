// Pins a PRE-EXISTING platform hazard: the dock OFFERS approvals the SDK's responder cannot REACH.
// `getPendingApprovals` walks every assistant message (#5919); `addToolApprovalResponse` rewrites
// only the last one, so an approval behind a later message is a dead card — the click updates
// nothing and no request is ever made. `applySdkApprovalResponse` mirrors the SDK's update verbatim.
// If the SDK's scope ever widens, the last two tests flip and this file should be revisited.
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

/** An approval parked behind the empty assistant carrier a failed turn appends. */
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
