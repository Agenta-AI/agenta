import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import type {EmbedConversation} from "../../src/features/embed/embedClient"
import {
    choiceToken,
    currentConversation,
    isAwaitingSatisfied,
    sendOutcome,
    unrecordedSends,
    type PendingSends,
} from "../../src/features/embed/embedConversationModel"
import {attachmentIdFromUrl} from "../../src/features/embed/embedFiles"

const row = (thread_id: string, session_id: string): EmbedConversation => ({
    thread_id,
    session_id,
    is_active: true,
})

describe("the conversation list after a command (D12)", () => {
    it("a first message is seen once any conversation exists", () => {
        const awaiting = {kind: "thread", previousThreadId: null} as const
        expect(isAwaitingSatisfied(awaiting, [])).toBe(false)
        expect(isAwaitingSatisfied(awaiting, [row("t1", "s1")])).toBe(true)
    })

    it("New chat is seen once the newest conversation is another one", () => {
        const awaiting = {kind: "thread", previousThreadId: "t1"} as const
        expect(isAwaitingSatisfied(awaiting, [row("t1", "s1")])).toBe(false)
        expect(isAwaitingSatisfied(awaiting, [row("t2", "s2"), row("t1", "s1")])).toBe(true)
    })

    it("a reopen is seen once the newest conversation is the target's session", () => {
        const awaiting = {kind: "session", target: row("t1", "s1")} as const
        expect(isAwaitingSatisfied(awaiting, [row("t2", "s2"), row("t1", "s1")])).toBe(false)
        // The reopened conversation is a new row that reuses the session.
        expect(isAwaitingSatisfied(awaiting, [row("t3", "s1"), row("t2", "s2")])).toBe(true)
    })

    it("the newest row is where the next message goes", () => {
        expect(currentConversation([row("t3", "s1"), row("t2", "s2")])?.thread_id).toBe("t3")
        expect(currentConversation(undefined)).toBe(null)
    })
})

describe("choiceToken", () => {
    it("picks the open choice's approve or deny token", () => {
        const tokens = ["row-1:approve", "row-1:deny"]
        expect(choiceToken(tokens, true)).toBe("row-1:approve")
        expect(choiceToken(tokens, false)).toBe("row-1:deny")
        expect(choiceToken([], true)).toBe(null)
    })
})

describe("attachmentIdFromUrl", () => {
    it("reads the attachment id from a replayed file part", () => {
        expect(
            attachmentIdFromUrl(
                "https://api.example.test/api/sessions/attachments/a-1/content?session_id=s",
            ),
        ).toBe("a-1")
        expect(attachmentIdFromUrl("blob:https://x/1")).toBe(null)
        expect(attachmentIdFromUrl(undefined)).toBe(null)
    })
})

describe("the wait for a reply to sent messages", () => {
    const pending = (count = 1, unstartedTurns = 0): PendingSends => ({
        sessionId: "s1",
        userCount: 1,
        unstartedTurns,
        messages: Array.from({length: count}, (_, index) => ({text: `m${index}`, fileNames: []})),
    })
    const message = (role: UIMessage["role"]) => ({id: role, role, parts: []}) as UIMessage
    const before = [message("user"), message("assistant")]
    const user = message("user")
    const reply = message("assistant")

    it("keeps waiting after the records hold the message, until a reply follows it", () => {
        expect(sendOutcome(pending(), before, 0)).toBe("waiting")
        expect(sendOutcome(pending(), [...before, user], 0)).toBe("waiting")
        expect(sendOutcome(pending(), [...before, user, reply], 0)).toBe("replied")
    })

    it("fails when a turn never started, which the records cannot show", () => {
        expect(sendOutcome(pending(1, 1), before, 2)).toBe("failed")
        expect(sendOutcome(pending(1, 1), before, 1)).toBe("waiting")
    })

    it("a queued second message waits past the first message's reply", () => {
        expect(sendOutcome(pending(2), [...before, user, reply], 0)).toBe("waiting")
        expect(unrecordedSends(pending(2), [...before, user, reply])).toEqual([
            {text: "m1", fileNames: []},
        ])
        expect(sendOutcome(pending(2), [...before, user, reply, user, reply], 0)).toBe("replied")
    })

    it("a second message that never started fails once the first is answered", () => {
        expect(sendOutcome(pending(2), [...before, user], 1)).toBe("failed")
        expect(sendOutcome(pending(2), before, 1)).toBe("waiting")
    })
})
