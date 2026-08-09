/**
 * Rewind forks the conversation instead of truncating it in place — the durable record log is
 * append-only and the runner answers from its own session transcript, so a local truncation is
 * undone by the next hydration AND still remembered by the agent.
 */
import type {UIMessage} from "ai"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {pendingRewindRerunAtom, rewindForkAtomFamily} from "./rewindFork"
import {
    composerDraftBySession,
    hasUnloggedHistory,
    unloggedHistorySessionIds,
} from "./sessionEphemera"
import {
    activeSessionIdAtomFamily,
    adoptSessionAtomFamily,
    persistSessionMessagesAtom,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
    sessionsListAtomFamily,
} from "./sessions"

const msg = (id: string, role: "user" | "assistant", text: string): UIMessage =>
    ({id, role, parts: [{type: "text", text}]}) as UIMessage

const u1 = msg("u1", "user", "first")
const a1 = msg("a1", "assistant", "answer")
const u2 = msg("u2", "user", "second")
const a2 = msg("a2", "assistant", "second answer")

/** A scope with one session holding the four messages above, opened as the active tab. */
const seedConversation = (store: ReturnType<typeof createStore>, scope: string) => {
    const origin = `origin-${scope}`
    store.set(adoptSessionAtomFamily(scope), {id: origin, title: "Original"})
    store.set(persistSessionMessagesAtom, {id: origin, messages: [u1, a1, u2, a2]})
    return origin
}

describe("rewindForkAtomFamily", () => {
    beforeEach(() => {
        unloggedHistorySessionIds.clear()
        composerDraftBySession.clear()
    })

    it("seeds a new active session with the kept prefix and leaves the original whole", () => {
        const store = createStore()
        const scope = `fork-basic-${Date.now()}`
        const origin = seedConversation(store, scope)

        // Rewind at the second user message: everything before it is kept.
        const forkId = store.set(rewindForkAtomFamily(scope), {
            fromSessionId: origin,
            messages: [u1, a1],
            draft: "second",
        })

        expect(forkId).not.toBe(origin)
        expect(store.get(sessionMessagesAtom)[forkId]).toEqual([u1, a1])
        // The rewound turns are still THERE, under the id whose record log holds them.
        expect(store.get(sessionMessagesAtom)[origin]).toEqual([u1, a1, u2, a2])

        // The fork takes over the tab strip; the original stays in history, one click away.
        expect(store.get(activeSessionIdAtomFamily(scope))).toBe(forkId)
        expect(store.get(sessionsListAtomFamily(scope)).map((s) => s.id)).toEqual([forkId])
        expect(store.get(sessionHistoryAtomFamily(scope)).map((s) => s.id)).toContain(origin)
    })

    it("marks the fork's prefix as un-logged so its first request replays the transcript", () => {
        const store = createStore()
        const scope = `fork-unlogged-${Date.now()}`
        const origin = seedConversation(store, scope)

        const forkId = store.set(rewindForkAtomFamily(scope), {
            fromSessionId: origin,
            messages: [u1, a1],
        })
        expect(hasUnloggedHistory(forkId)).toBe(true)
    })

    it("does not mark an empty fork — rewinding the first message leaves nothing to replay", () => {
        const store = createStore()
        const scope = `fork-empty-${Date.now()}`
        const origin = seedConversation(store, scope)

        const forkId = store.set(rewindForkAtomFamily(scope), {
            fromSessionId: origin,
            messages: [],
            draft: "first",
        })
        expect(store.get(sessionMessagesAtom)[forkId]).toEqual([])
        expect(hasUnloggedHistory(forkId)).toBe(false)
    })

    it("pre-fills the composer for a user-side rewind and asks for no re-run", () => {
        const store = createStore()
        const scope = `fork-draft-${Date.now()}`
        const origin = seedConversation(store, scope)

        const forkId = store.set(rewindForkAtomFamily(scope), {
            fromSessionId: origin,
            messages: [u1, a1],
            draft: "second",
        })
        expect(composerDraftBySession.get(forkId)).toBe("second")
        expect(store.get(pendingRewindRerunAtom)).toBeNull()
    })

    it("asks the fork to re-run its trailing user turn for an assistant-side rewind", () => {
        const store = createStore()
        const scope = `fork-rerun-${Date.now()}`
        const origin = seedConversation(store, scope)

        // Rewind at the second assistant message: the prefix ends on the user turn to re-run.
        const forkId = store.set(rewindForkAtomFamily(scope), {
            fromSessionId: origin,
            messages: [u1, a1, u2],
            rerun: true,
        })
        expect(store.get(sessionMessagesAtom)[forkId]).toEqual([u1, a1, u2])
        expect(store.get(pendingRewindRerunAtom)).toBe(forkId)
        expect(composerDraftBySession.get(forkId)).toBeUndefined()
    })
})
