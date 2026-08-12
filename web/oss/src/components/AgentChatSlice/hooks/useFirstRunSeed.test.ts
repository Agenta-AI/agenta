/**
 * Unit test for `shouldConsumeSeed` — which session may claim the message a composer sent along
 * with its navigation.
 *
 * Regression: sending from an agent's overview put the message in the PREVIOUS session and left the
 * new one empty (reproduced live on the 8180 dev stack: "PROBE-A1 …" landed in session
 * 7e156d7b-61ce-49c6-8553-ca45b6eb6356 while the freshly created a1c5e023-… became the active,
 * empty tab). The panel creates the new session in a parent effect, but a warm lazy chunk mounts
 * the previous session's conversation in the same commit — and child effects run first, so the old
 * session was still active and, with an unhydrated transcript, still looked empty when it claimed
 * the seed.
 */
import {describe, expect, it} from "vitest"

import {type AgentFirstRunSeed} from "../state/firstRunSeed"

import {shouldConsumeSeed} from "./useFirstRunSeed"

const APP = "app-1"
const NEW_SESSION = "session-new"
const OLD_SESSION = "session-old"

const addressed: AgentFirstRunSeed = {
    appId: APP,
    sessionId: NEW_SESSION,
    seedMessage: "ship it",
    autoSend: true,
}

/** The id-less seed the agent-creation flow still sends. */
const legacy: AgentFirstRunSeed = {appId: APP, seedMessage: "ship it", autoSend: true}

const ask = (over: Partial<Parameters<typeof shouldConsumeSeed>[0]>) =>
    shouldConsumeSeed({
        seed: addressed,
        entityId: "revision-1",
        scopeKey: APP,
        sessionId: NEW_SESSION,
        activeSessionId: NEW_SESSION,
        messagesCount: 0,
        isHydrating: false,
        ...over,
    })

describe("shouldConsumeSeed", () => {
    it("gives an addressed seed to the session it names", () => {
        expect(ask({})).toBe(true)
    })

    it("refuses an addressed seed in any other session, even the active empty one", () => {
        expect(ask({sessionId: OLD_SESSION, activeSessionId: OLD_SESSION})).toBe(false)
    })

    it("still gives an addressed seed to its session when that session is not yet active", () => {
        expect(ask({activeSessionId: OLD_SESSION})).toBe(true)
    })

    it("ignores a seed aimed at a different agent", () => {
        expect(ask({scopeKey: "app-2", entityId: "revision-of-app-2"})).toBe(false)
    })

    it("does nothing without a seed", () => {
        expect(ask({seed: null})).toBe(false)
    })

    it("matches a legacy seed on the active empty conversation", () => {
        expect(ask({seed: legacy})).toBe(true)
    })

    it("refuses a legacy seed while the transcript is still hydrating", () => {
        expect(ask({seed: legacy, isHydrating: true})).toBe(false)
    })

    it("refuses a legacy seed in a conversation that already has messages", () => {
        expect(ask({seed: legacy, messagesCount: 3})).toBe(false)
    })

    it("refuses a legacy seed in an inactive session", () => {
        expect(ask({seed: legacy, sessionId: OLD_SESSION})).toBe(false)
    })

    it("matches a legacy seed by revision id when the scope has not resolved", () => {
        expect(ask({seed: {...legacy, revisionId: "revision-1"}, scopeKey: "__global__"})).toBe(
            true,
        )
    })
})
