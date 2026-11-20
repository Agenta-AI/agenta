import type {PendingSessionInput} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {childUpdateOfInput} from "../../src/assets/childUpdate"
import {pendingInputToQueuedMessage} from "../../src/assets/pendingInputs"

const input = (
    kind: string | null | undefined,
    message: Record<string, unknown>,
): PendingSessionInput => ({
    id: "input-1",
    session_id: "calling",
    content: {data: {inputs: {messages: [message]}}},
    position: 0,
    state: "pending",
    policy: "queue",
    kind,
    idempotency_key: "ag:child_update:child:exec",
})

const part = {session_id: "child", turn_id: "turn-1", status: "failed"}

describe("child update rows", () => {
    it("reads the structured part of a child_update row", () => {
        const row = input("child_update", {role: "user", content: "marked text", child_update: part})
        expect(childUpdateOfInput(row)).toEqual({
            sessionId: "child",
            turnId: "turn-1",
            status: "failed",
        })
        expect(pendingInputToQueuedMessage(row)).toMatchObject({
            id: "input-1",
            serverKind: "child_update",
            editable: false,
            childUpdate: {sessionId: "child", status: "failed"},
        })
    })

    it("ignores the part on a message row, so a client copy stays an ordinary message", () => {
        for (const kind of ["message", null, undefined]) {
            const row = input(kind, {role: "user", content: "hi", child_update: part})
            expect(childUpdateOfInput(row)).toBeNull()
            const queued = pendingInputToQueuedMessage(row)
            expect(queued?.serverKind).toBeUndefined()
            expect(queued?.childUpdate).toBeUndefined()
            expect(queued?.editable).toBe(true)
        }
    })

    it("keeps an unknown status as an update with no status", () => {
        const row = input("child_update", {
            role: "user",
            content: "marked text",
            child_update: {session_id: "child", status: "later_value"},
        })
        expect(childUpdateOfInput(row)).toEqual({sessionId: "child", turnId: null, status: null})
    })

    it("returns no part when the row has no child session id", () => {
        const row = input("child_update", {role: "user", content: "marked text", child_update: {}})
        expect(childUpdateOfInput(row)).toBeNull()
        expect(pendingInputToQueuedMessage(row)).toMatchObject({serverKind: "child_update"})
    })
})
