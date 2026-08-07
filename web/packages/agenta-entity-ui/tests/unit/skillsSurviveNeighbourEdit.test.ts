/**
 * A skills entry the panel did not author must survive a neighbour's edit, byte-identical.
 *
 * This exists because of a real data-loss report: an agent committed a skill as an `@ag.embed`
 * reference, and a later save stored `skills: []`. The forensics cleared the panel (the entry was
 * never in that browser's draft, which predated the agent's commit), but "the save path preserves
 * what it did not author" was an assumed property with nothing pinning it. Now it is pinned.
 *
 * Three shapes, chosen because each is preserved for a DIFFERENT reason:
 *   a) a valid `@ag.embed` reference — recognized, rendered as a read-only "Skill reference";
 *   b) the malformed embed from that session (`@ag.references: {file: …}`) — an embed the engine
 *      should never have stored, whose value resolves to nothing the panel understands;
 *   c) a `__ag__` static — recognized and deliberately NOT editable.
 *
 * The test asserts the stored array, not any panel state, and compares against a deep-frozen
 * original so a mutation in place fails instead of passing by shared reference.
 */
import {describe, expect, it} from "vitest"

import {
    applyItemToList,
    removeItemFromList,
} from "../../src/DrillInView/SchemaControls/agentTemplate/itemListOps"

const VALID_EMBED = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "release-qa"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

// Exactly the shape from session cfa9d1ed: the agent invented a file reference.
const MALFORMED_EMBED = {
    "@ag.embed": {
        "@ag.references": {
            file: "/tmp/agenta/mounts/019fd681-26a8-7d80-93c6-a18a009f8a95/019fd6a7-097b-7041-a19c-732ac2823da3-agent/gstack-autoplan/SKILL.md",
        },
    },
}

const STATIC_EMBED = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "__ag__getting_started_with_agenta"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

const INLINE_SKILL = {name: "release-notes", description: "Draft release notes.", body: "Read it."}

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze)
        Object.freeze(value)
    }
    return value
}

/** The stored list as the agent left it: three unauthored shapes plus one editable skill. */
const storedSkills = () =>
    deepFreeze([VALID_EMBED, MALFORMED_EMBED, STATIC_EMBED, INLINE_SKILL] as unknown[])

describe("editing a neighbouring skill", () => {
    it("leaves every entry the panel did not author byte-identical", () => {
        const list = storedSkills()
        const edited = {...INLINE_SKILL, body: "Read the changelog first."}

        // The user opens the one editable skill (index 3) and saves it.
        const next = applyItemToList(list, {mode: "edit", index: 3}, edited)

        expect(next).toHaveLength(4)
        expect(next[0]).toEqual(VALID_EMBED)
        expect(next[1]).toEqual(MALFORMED_EMBED)
        expect(next[2]).toEqual(STATIC_EMBED)
        expect(next[3]).toEqual(edited)
    })

    it.each([
        ["a valid @ag.embed reference", 0, VALID_EMBED],
        ["the malformed embed from the reported session", 1, MALFORMED_EMBED],
        ["a __ag__ static skill", 2, STATIC_EMBED],
    ])("keeps %s across the save", (_label, index, entry) => {
        const next = applyItemToList(storedSkills(), {mode: "edit", index: 3}, {name: "edited"})

        // Deep equality AND the exact stored value, so a re-serialization that reorders or drops a
        // marker key (`@ag.selector`, the nested `@ag.references`) fails here.
        expect(next[index as number]).toEqual(entry)
        expect(JSON.stringify(next[index as number])).toBe(JSON.stringify(entry))
    })

    it("adds a new skill without disturbing the stored ones", () => {
        const next = applyItemToList(storedSkills(), {mode: "create", index: -1}, {name: "new"})

        expect(next).toHaveLength(5)
        expect(next.slice(0, 4)).toEqual(storedSkills())
    })

    it("refuses an out-of-range index rather than reshaping the list", () => {
        // A stale drawer index must not punch a hole into the stored array.
        const list = storedSkills()

        expect(applyItemToList(list, {mode: "edit", index: 9}, {name: "x"})).toEqual(list)
        expect(applyItemToList(list, {mode: "edit", index: -1}, {name: "x"})).toEqual(list)
    })
})

describe("removing one skill", () => {
    it("drops only the named index and preserves the unauthored neighbours", () => {
        const next = removeItemFromList(storedSkills(), 3)

        expect(next).toEqual([VALID_EMBED, MALFORMED_EMBED, STATIC_EMBED])
    })
})
