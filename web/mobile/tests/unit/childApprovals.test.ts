import type {SessionInteraction, SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    childApprovalsOf,
    otherWaitingSessionIds,
    SESSION_QUERY_BATCH,
    sessionIdBatches,
} from "../../src/features/chat/childApprovals"

const gate = (overrides: Partial<SessionInteraction> = {}): SessionInteraction => ({
    id: "int-1",
    session_id: "child-a",
    turn_id: "exec-a",
    token: "gate-1",
    kind: "user_approval",
    status: "pending",
    created_at: "2026-11-21T10:00:00Z",
    data: {request: {tool: "send_email", args: {to: "ana@example.com"}, tool_call_id: "call-1"}},
    ...overrides,
})

const session = (sessionId: string, callingSessionId: string | null): SessionStream => ({
    project_id: "proj-1",
    session_id: sessionId,
    origin: callingSessionId ? "calling_session" : "manual",
    calling_session: callingSessionId ? {id: callingSessionId} : null,
})

describe("otherWaitingSessionIds", () => {
    it("lists the other sessions that wait on an approval, once each and sorted", () => {
        const rows = [
            gate({session_id: "child-b"}),
            gate({id: "int-2", token: "gate-2", session_id: "child-a"}),
            gate({id: "int-3", token: "gate-3", session_id: "child-b"}),
        ]
        expect(otherWaitingSessionIds(rows, "parent")).toEqual(["child-a", "child-b"])
    })

    it("leaves out the open session (its own card shows its gates) and other kinds", () => {
        const rows = [
            gate({session_id: "parent"}),
            gate({id: "int-2", token: "gate-2", session_id: "child-a", kind: "user_input"}),
        ]
        expect(otherWaitingSessionIds(rows, "parent")).toEqual([])
    })

    it("is empty before the interactions answer", () => {
        expect(otherWaitingSessionIds(undefined, "parent")).toEqual([])
    })
})

describe("childApprovalsOf", () => {
    it("builds the card's approval from the stored row: the token, the tool and its arguments", () => {
        const out = childApprovalsOf({
            interactions: [gate()],
            sessions: [session("child-a", "parent")],
            sessionId: "parent",
        })
        expect(out).toEqual([
            {
                sessionId: "child-a",
                approvals: [
                    {
                        approvalId: "gate-1",
                        toolName: "send_email",
                        input: {to: "ana@example.com"},
                    },
                ],
            },
        ])
    })

    it("shows a second child's approval as its own entry", () => {
        const out = childApprovalsOf({
            interactions: [
                gate({id: "int-b", token: "gate-b", session_id: "child-b"}),
                gate({created_at: "2026-11-21T09:00:00Z"}),
            ],
            sessions: [session("child-a", "parent"), session("child-b", "parent")],
            sessionId: "parent",
        })
        expect(out.map((child) => child.sessionId)).toEqual(["child-a", "child-b"])
        expect(out[1].approvals.map((approval) => approval.approvalId)).toEqual(["gate-b"])
    })

    it("keeps two gates of one child together, in the order the child asked", () => {
        const out = childApprovalsOf({
            interactions: [
                gate({id: "int-2", token: "gate-2", created_at: "2026-11-21T10:05:00Z"}),
                gate(),
            ],
            sessions: [session("child-a", "parent")],
            sessionId: "parent",
        })
        expect(out).toHaveLength(1)
        expect(out[0].approvals.map((approval) => approval.approvalId)).toEqual([
            "gate-1",
            "gate-2",
        ])
    })

    it("leaves out a waiting session that another session, or a person, started", () => {
        const out = childApprovalsOf({
            interactions: [
                gate({session_id: "child-of-other"}),
                gate({id: "int-2", token: "gate-2", session_id: "a-person's-chat"}),
            ],
            sessions: [session("child-of-other", "other-parent"), session("a-person's-chat", null)],
            sessionId: "parent",
        })
        expect(out).toEqual([])
    })

    it("leaves out a row with no token: the card could not name its gate", () => {
        const out = childApprovalsOf({
            interactions: [gate({token: null})],
            sessions: [session("child-a", "parent")],
            sessionId: "parent",
        })
        expect(out).toEqual([])
    })
})

describe("sessionIdBatches", () => {
    it("splits the ids at the server's page limit and leaves none out", () => {
        const ids = Array.from({length: SESSION_QUERY_BATCH * 2 + 1}, (_, i) => `s-${i}`)
        const batches = sessionIdBatches(ids)
        expect(batches.map((batch) => batch.length)).toEqual([
            SESSION_QUERY_BATCH,
            SESSION_QUERY_BATCH,
            1,
        ])
        expect(batches.flat()).toEqual(ids)
    })

    it("is empty for no ids", () => {
        expect(sessionIdBatches([])).toEqual([])
    })
})
