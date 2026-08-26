import {describe, expect, it} from "vitest"

import {SHORTCUTS} from "../../../src/keyboard/catalog"
import {altChord, bare, code, key, modChord} from "../../../src/keyboard/chord"
import {matchesChord, passesGuards} from "../../../src/keyboard/matchChord"
import type {KeyEventLike, ShortcutDefinition} from "../../../src/keyboard/types"

const event = (over: Partial<KeyEventLike> = {}): KeyEventLike => ({
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...over,
})

describe("matchesChord — the mod key", () => {
    const chord = modChord(key("Enter"))

    it("takes Meta on a Mac and Control elsewhere", () => {
        expect(matchesChord(chord, event({key: "Enter", metaKey: true}), true)).toBe(true)
        expect(matchesChord(chord, event({key: "Enter", ctrlKey: true}), false)).toBe(true)
    })

    it("rejects the other platform's modifier", () => {
        expect(matchesChord(chord, event({key: "Enter", ctrlKey: true}), true)).toBe(false)
        expect(matchesChord(chord, event({key: "Enter", metaKey: true}), false)).toBe(false)
    })

    it("rejects both held at once, on either platform", () => {
        const both = event({key: "Enter", metaKey: true, ctrlKey: true})
        expect(matchesChord(chord, both, true)).toBe(false)
        expect(matchesChord(chord, both, false)).toBe(false)
    })
})

describe("matchesChord — an unspecified modifier is forbidden", () => {
    // The bug this pins: Escape denies an approval today even with Shift or Alt held.
    const escape = bare(key("Escape"))

    it("matches a bare press", () => {
        expect(matchesChord(escape, event({key: "Escape"}), true)).toBe(true)
    })

    it.each([["shiftKey"], ["altKey"], ["metaKey"], ["ctrlKey"]])(
        "rejects the press with %s held",
        (modifier) => {
            expect(matchesChord(escape, event({key: "Escape", [modifier]: true}), true)).toBe(false)
        },
    )
})

describe("matchesChord — Alt and AltGr", () => {
    const chord = altChord(code("KeyZ"))

    it("matches a bare Alt chord", () => {
        expect(matchesChord(chord, event({key: "Ω", code: "KeyZ", altKey: true}), true)).toBe(true)
    })

    it("rejects Ctrl+Alt, so European AltGr keeps typing", () => {
        const altGr = event({key: "ż", code: "KeyZ", altKey: true, ctrlKey: true})
        expect(matchesChord(chord, altGr, false)).toBe(false)
    })
})

describe("matchesChord — physical versus logical keys", () => {
    it("matches Option+1 by position, where the character is lost", () => {
        const optionOne = event({key: "¡", code: "Digit1", altKey: true})
        expect(matchesChord(altChord(code("Digit1")), optionOne, true)).toBe(true)
        expect(matchesChord(altChord(key("1")), optionOne, true)).toBe(false)
    })

    it("compares logical keys case-insensitively", () => {
        expect(matchesChord(modChord(key("b")), event({key: "B", metaKey: true}), true)).toBe(true)
    })

    it("treats a space and the name Space as the same key", () => {
        expect(matchesChord(bare(key("Space")), event({key: " "}), true)).toBe(true)
    })
})

describe("passesGuards", () => {
    const def = (guards?: ShortcutDefinition["guards"]): ShortcutDefinition =>
        ({
            id: "test" as ShortcutDefinition["id"],
            section: "sessions" as ShortcutDefinition["section"],
            chords: [],
            label: "Test",
            guards,
        }) as ShortcutDefinition

    const ctx = {isMac: true, typingTarget: false}

    it("blocks auto-repeat unless the shortcut asks for it", () => {
        expect(passesGuards(def(), event({repeat: true}), ctx)).toBe(false)
        expect(passesGuards(def({allowRepeat: true}), event({repeat: true}), ctx)).toBe(true)
    })

    it("blocks a keystroke mid-IME-composition", () => {
        expect(passesGuards(def(), event({isComposing: true}), ctx)).toBe(false)
    })

    it("blocks a typing target by default", () => {
        expect(passesGuards(def(), event(), {...ctx, typingTarget: true})).toBe(false)
    })

    it("reproduces the approval card: the mod chord fires from a field, a bare key does not", () => {
        const typing = {isMac: true, typingTarget: true}
        const approve = def({typing: "allow-with-mod"})
        expect(passesGuards(approve, event({key: "Enter", metaKey: true}), typing)).toBe(true)
        expect(passesGuards(approve, event({key: "Escape"}), typing)).toBe(false)
    })
})

describe("the catalog's own chords", () => {
    it("names a physical key for every Alt chord", () => {
        const offenders = SHORTCUTS.filter((def) =>
            def.chords.some(
                (chord) => chord.alt === "required" && chord.target.kind !== "physical",
            ),
        ).map((def) => def.id)
        expect(offenders).toEqual([])
    })
})

describe("a chord limited to one platform", () => {
    // Lexical answers Ctrl+Y off Apple hardware only; listing it everywhere would advertise a
    // key the editor ignores.
    const ctrlY = bare(key("y"), {ctrl: "required", only: "other"})

    it("matches off Apple hardware", () => {
        expect(matchesChord(ctrlY, event({key: "y", ctrlKey: true}), false)).toBe(true)
    })

    it("never matches on a Mac", () => {
        expect(matchesChord(ctrlY, event({key: "y", ctrlKey: true}), true)).toBe(false)
    })
})
