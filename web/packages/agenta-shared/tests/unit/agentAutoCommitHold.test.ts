/**
 * Unit tests for the auto-commit hold registry.
 *
 * The hold is what keeps an unattended commit from landing mid-run and failing the agent's own
 * `commit_revision` (which checks HEAD). Two properties carry that guarantee: a revision is free
 * only once EVERY holder releases, and a holder that moves to another revision releases the one
 * it left rather than pinning it forever.
 */
import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {
    agentAutoCommitHeldAtomFamily,
    agentAutoCommitHoldsAtom,
    setAgentAutoCommitHoldAtom,
} from "../../src/state/agentAutoCommitHold"

let store: ReturnType<typeof createStore>
const REV = "rev-1"
const OTHER = "rev-2"

const hold = (revisionId: string, key: string, held: boolean) =>
    store.set(setAgentAutoCommitHoldAtom, {revisionId, key, held})

beforeEach(() => {
    store = createStore()
})

describe("agentAutoCommitHold", () => {
    it("is not held by default", () => {
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(false)
    })

    it("holds and releases for a single session", () => {
        hold(REV, "s1", true)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(true)
        hold(REV, "s1", false)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(false)
    })

    it("stays held until every session releases", () => {
        hold(REV, "s1", true)
        hold(REV, "s2", true)
        hold(REV, "s1", false)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(true)
        hold(REV, "s2", false)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(false)
    })

    it("keeps revisions independent, so a hold can move with a revision switch", () => {
        hold(REV, "s1", true)
        expect(store.get(agentAutoCommitHeldAtomFamily(OTHER))).toBe(false)

        // What a self-commit does: take the new revision, release the old one.
        hold(OTHER, "s1", true)
        hold(REV, "s1", false)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(false)
        expect(store.get(agentAutoCommitHeldAtomFamily(OTHER))).toBe(true)
    })

    it("ignores a duplicate hold and a release of an unknown key", () => {
        hold(REV, "s1", true)
        const afterFirst = store.get(agentAutoCommitHoldsAtom)
        hold(REV, "s1", true)
        expect(store.get(agentAutoCommitHoldsAtom)).toBe(afterFirst)

        hold(REV, "never-held", false)
        expect(store.get(agentAutoCommitHoldsAtom)).toBe(afterFirst)
        expect(store.get(agentAutoCommitHeldAtomFamily(REV))).toBe(true)
    })

    it("drops the entry once released, so the record doesn't grow per revision visited", () => {
        hold(REV, "s1", true)
        hold(REV, "s1", false)
        expect(store.get(agentAutoCommitHoldsAtom)).not.toHaveProperty(REV)
    })

    it("ignores a blank revision or key", () => {
        hold("", "s1", true)
        hold(REV, "", true)
        expect(store.get(agentAutoCommitHoldsAtom)).toEqual({})
    })
})
