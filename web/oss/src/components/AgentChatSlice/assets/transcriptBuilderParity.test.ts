/**
 * Drift alarm between the TWO replay builders.
 *
 * `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts` and
 * `web/packages/agenta-chat/src/assets/transcriptToMessages.ts` are near-copies of each other.
 * They have silently diverged before, so this runs the SAME real-session fixtures through both
 * and deep-compares the messages they produce. Three divergences are known and DELIBERATE
 * (docs/design/client-tool-interaction-lifecycle/implementation.md, "6. Replay"); each is
 * encoded below as a named, asserted expectation. Anything outside that allowlist fails.
 *
 * The golden set itself — provenance, coverage, and the row join — lives in
 * `__fixtures__/goldenSessions.ts`.
 */
import {transcriptToMessages as pkgTranscriptToMessages} from "@agenta/chat/assets"
import type {SessionRecord} from "@agenta/entities/session"
import {
    APPROVED_EXECUTION_RESULT_UNKNOWN,
    APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX,
} from "@agenta/shared/utils"
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {GOLDEN_SESSIONS} from "./__fixtures__/goldenSessions"
import {transcriptToMessages as ossTranscriptToMessages} from "./transcriptToMessages"

type AnyPart = Record<string, unknown>

const partsOf = (messages: UIMessage[] | null): AnyPart[] =>
    (messages ?? []).flatMap((m) => m.parts as unknown as AnyPart[])

/**
 * ALLOWLIST 1 — "approval manifest sibling part".
 * The OSS copy emits a `data-approval-manifest` sibling beside an approval whose request carried
 * a manifest (transcriptToMessages.ts:358-370); the package copy has no equivalent, so a replayed
 * approval card there loses its manifest body. Deliberate; see implementation.md anchor 6, item 2.
 * Dropping it from BOTH sides is what lets the rest of the comparison be exact.
 */
const stripApprovalManifests = (messages: UIMessage[] | null): UIMessage[] =>
    (messages ?? []).map(
        (m) =>
            ({
                ...m,
                parts: (m.parts as unknown as AnyPart[]).filter(
                    (p) => p.type !== "data-approval-manifest",
                ),
            }) as unknown as UIMessage,
    )

describe("replay builder copy-parity (oss vs @agenta/chat)", () => {
    for (const golden of GOLDEN_SESSIONS) {
        it(`${golden.name}: both copies build identical messages from records alone`, () => {
            const oss = ossTranscriptToMessages(golden.records)
            const pkg = pkgTranscriptToMessages(golden.records)
            expect(partsOf(oss).length).toBeGreaterThan(0)
            expect(stripApprovalManifests(pkg)).toEqual(stripApprovalManifests(oss))
        })

        if (!golden.rows) continue

        it(`${golden.name}: both copies build identical messages once interaction rows settle them`, () => {
            const options = {interactionRowStates: golden.rows}
            const oss = ossTranscriptToMessages(golden.records, options)
            const pkg = pkgTranscriptToMessages(golden.records, options)
            expect(stripApprovalManifests(pkg)).toEqual(stripApprovalManifests(oss))
        })
    }
})

/**
 * The allowlist entries themselves are asserted, so re-syncing the copies (which would be a
 * legitimate change) shows up here as a failure asking for the allowlist to be updated, rather
 * than passing silently while the entry rots.
 */
describe("replay builder copy-parity: the three DELIBERATE divergences", () => {
    const approvalWithManifest = (): SessionRecord[] =>
        [
            {
                id: "r1",
                session_id: "s1",
                project_id: "p1",
                event_index: 0,
                sender: "agent",
                session_update: "interaction_request",
                payload: {
                    id: "approval-1",
                    kind: "user_approval",
                    type: "interaction_request",
                    payload: {
                        toolCall: {
                            toolCallId: "call-1",
                            resolvedName: "commit_revision",
                            kind: "execute",
                            rawInput: {workflow_revision: {}},
                        },
                        manifest: {files: [{path: "a.md"}]},
                    },
                },
                created_at: "2026-08-11T00:00:00Z",
            },
        ] as unknown as SessionRecord[]

    it("DIVERGENCE 1 — approval sentinel: OSS matches by equality, the package by prefix", () => {
        // implementation.md anchor 6, item 1. A sentinel errorText reopens the approval gate.
        // The package copy accepts the code plus trailing prose; OSS requires the exact string.
        const withSentinel = (errorText: string): SessionRecord[] =>
            [
                {
                    id: "r1",
                    session_id: "s1",
                    project_id: "p1",
                    event_index: 0,
                    sender: "agent",
                    session_update: "tool_call",
                    payload: {id: "call-1", name: "commit_revision", type: "tool_call", input: {}},
                    created_at: "2026-08-11T00:00:00Z",
                },
                {
                    id: "r2",
                    session_id: "s1",
                    project_id: "p1",
                    event_index: 1,
                    sender: "agent",
                    session_update: "tool_result",
                    payload: {id: "call-1", type: "tool_result", isError: true, output: errorText},
                    created_at: "2026-08-11T00:00:01Z",
                },
                {
                    id: "r3",
                    session_id: "s1",
                    project_id: "p1",
                    event_index: 2,
                    sender: "agent",
                    session_update: "interaction_request",
                    payload: {
                        id: "approval-1",
                        kind: "user_approval",
                        type: "interaction_request",
                        payload: {
                            toolCall: {toolCallId: "call-1", resolvedName: "commit_revision"},
                        },
                    },
                    created_at: "2026-08-11T00:00:02Z",
                },
            ] as unknown as SessionRecord[]

        // The exact sentinel: both copies reopen the gate. No divergence here.
        const exact = withSentinel(APPROVED_EXECUTION_RESULT_UNKNOWN)
        expect(partsOf(ossTranscriptToMessages(exact))[0].state).toBe("approval-requested")
        expect(partsOf(pkgTranscriptToMessages(exact))[0].state).toBe("approval-requested")

        // The sentinel CODE with extra prose appended: only the package copy reopens the gate.
        const withSuffix = withSentinel(`${APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX}: and more`)
        expect(partsOf(ossTranscriptToMessages(withSuffix))[0].state).toBe("output-error")
        expect(partsOf(pkgTranscriptToMessages(withSuffix))[0].state).toBe("approval-requested")
    })

    it("DIVERGENCE 2 — only OSS emits the `data-approval-manifest` sibling part", () => {
        // implementation.md anchor 6, item 2. The package copy's replayed approval card loses
        // its manifest body; `ApprovalDock.manifestsByToolCallId` (ApprovalDock.tsx:35-46) is the
        // reader that goes empty there.
        const records = approvalWithManifest()
        const ossManifests = partsOf(ossTranscriptToMessages(records)).filter(
            (p) => p.type === "data-approval-manifest",
        )
        const pkgManifests = partsOf(pkgTranscriptToMessages(records)).filter(
            (p) => p.type === "data-approval-manifest",
        )
        expect(ossManifests).toHaveLength(1)
        expect(ossManifests[0]).toMatchObject({
            id: "call-1",
            data: {toolCallId: "call-1", approvalId: "approval-1"},
        })
        expect(pkgManifests).toHaveLength(0)
    })

    it("DIVERGENCE 3 — `attachment_delivery` is a COMMENT-only difference today", () => {
        // implementation.md anchor 6, item 3 recorded this as behavioral. It no longer is: both
        // copies fall through the same `default:` arm and drop the event. Asserted so that if
        // either copy grows a real `attachment_delivery` branch, this fails and the divergence
        // list gets revisited instead of quietly becoming true again.
        const records = [
            {
                id: "r1",
                session_id: "s1",
                project_id: "p1",
                event_index: 0,
                sender: "agent",
                session_update: "attachment_delivery",
                payload: {id: "a1", type: "attachment_delivery", attachmentId: "att-1"},
                created_at: "2026-08-11T00:00:00Z",
            },
            {
                id: "r2",
                session_id: "s1",
                project_id: "p1",
                event_index: 1,
                sender: "agent",
                session_update: "message",
                payload: {type: "message", text: "hi"},
                created_at: "2026-08-11T00:00:01Z",
            },
        ] as unknown as SessionRecord[]
        expect(pkgTranscriptToMessages(records)).toEqual(ossTranscriptToMessages(records))
        expect(partsOf(ossTranscriptToMessages(records))).toEqual([{type: "text", text: "hi"}])
    })
})
