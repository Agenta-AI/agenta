/**
 * The conversation's mount identity.
 *
 * A remount tears down the chat engine and its unmount aborts the live stream, so this key is a
 * correctness boundary, not cosmetics: with the revision in it, editing the config during a run
 * cancelled the run — auto-commit switched the revision and React rebuilt the conversation.
 */
import {describe, expect, it} from "vitest"

import {conversationKey} from "../../src/features/chat/conversationKey"

describe("conversationKey", () => {
    it("does not change when the revision does — a mid-run commit must not remount", () => {
        const before = conversationKey({sessionId: "s1", revisionId: "rev-1"})
        const after = conversationKey({sessionId: "s1", revisionId: "rev-2"})
        expect(after).toBe(before)
    })

    it("is stable when no revision is pinned yet", () => {
        expect(conversationKey({sessionId: "s1", revisionId: null})).toBe(
            conversationKey({sessionId: "s1", revisionId: "rev-1"}),
        )
    })

    it("still separates sessions, so one transcript cannot show under another's tab", () => {
        expect(conversationKey({sessionId: "s1", revisionId: "rev-1"})).not.toBe(
            conversationKey({sessionId: "s2", revisionId: "rev-1"}),
        )
    })
})
