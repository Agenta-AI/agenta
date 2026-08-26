import {describe, expect, it} from "vitest"

import {SHORTCUTS} from "../../../src/keyboard/catalog"
import {chordAppliesTo, matchesChord} from "../../../src/keyboard/matchChord"
import {validateCatalog} from "../../../src/keyboard/registry"
import {SECTIONS_BY_ID} from "../../../src/keyboard/sections"
import type {Chord, KeyEventLike, ShortcutDefinition} from "../../../src/keyboard/types"

/** The event a chord asks for, so two chords can be compared by what they would both answer. */
const synthesize = (chord: Chord, isMac: boolean): KeyEventLike => ({
    key: chord.target.kind === "logical" ? chord.target.key : "",
    code: chord.target.kind === "physical" ? chord.target.code : "",
    altKey: chord.alt === "required",
    shiftKey: chord.shift === "required",
    metaKey: chord.meta === "required" || (isMac && chord.mod === "required"),
    ctrlKey: chord.ctrl === "required" || (!isMac && chord.mod === "required"),
})

describe("validateCatalog", () => {
    it("reports no problems", () => {
        expect(validateCatalog()).toEqual([])
    })
})

describe("catalog shape", () => {
    it("gives every entry a section that exists", () => {
        const orphans = SHORTCUTS.filter((def) => !SECTIONS_BY_ID.has(def.section))
        expect(orphans.map((def) => def.id)).toEqual([])
    })

    it("gives every entry a unique id", () => {
        const ids = SHORTCUTS.map((def) => def.id)
        expect(ids.length).toBe(new Set(ids).size)
    })
})

describe.each([
    ["a Mac", true],
    ["Windows", false],
])("chord collisions on %s", (_name, isMac) => {
    // Both platforms are checked independently: `mod` collapses to different physical modifiers,
    // so a pair can be clean on a Mac and collide on Windows.
    it("does not let two entries share a section, a context and a chord", () => {
        const claims = new Map<string, ShortcutDefinition[]>()

        SHORTCUTS.forEach((def) => {
            def.chords.forEach((chord) => {
                const probe = synthesize(chord, isMac)
                const bucket = [
                    def.section,
                    def.context ?? "",
                    probe.key.toLowerCase(),
                    probe.code,
                    probe.altKey,
                    probe.shiftKey,
                    probe.metaKey,
                    probe.ctrlKey,
                ].join("|")
                const existing = claims.get(bucket)
                if (existing) existing.push(def)
                else claims.set(bucket, [def])
            })
        })

        const collisions = [...claims.values()]
            .filter((defs) => new Set(defs.map((def) => def.id)).size > 1)
            .map((defs) => [...new Set(defs.map((def) => def.id))].join(" vs "))

        expect(collisions).toEqual([])
    })

    it("matches each entry's own chords back to itself", () => {
        SHORTCUTS.forEach((def) => {
            // A platform-limited chord is absent here by design, not unmatched.
            def.chords
                .filter((chord) => chordAppliesTo(chord, isMac))
                .forEach((chord) => {
                    expect(matchesChord(chord, synthesize(chord, isMac), isMac)).toBe(true)
                })
        })
    })
})
