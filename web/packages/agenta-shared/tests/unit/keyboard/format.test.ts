import {describe, expect, it} from "vitest"

import {altChord, bare, code, key, modChord} from "../../../src/keyboard/chord"
import {formatChord} from "../../../src/keyboard/format"

describe("formatChord", () => {
    it("spells the mod key the way each platform's keyboard does", () => {
        const chord = modChord(key("Enter"))
        expect(formatChord(chord, {isMac: true})).toBe("⌘↵")
        expect(formatChord(chord, {isMac: false})).toBe("Ctrl+Enter")
    })

    it("spells an Alt chord by the letter on the key", () => {
        const chord = altChord(code("KeyZ"))
        expect(formatChord(chord, {isMac: true})).toBe("⌥Z")
        expect(formatChord(chord, {isMac: false})).toBe("Alt+Z")
    })

    it("spells a digit chord by its digit", () => {
        expect(formatChord(altChord(code("Digit3")), {isMac: true})).toBe("⌥3")
    })

    it("spells Shift", () => {
        const chord = bare(key("Enter"), {shift: "required"})
        expect(formatChord(chord, {isMac: true})).toBe("⇧↵")
        expect(formatChord(chord, {isMac: false})).toBe("Shift+Enter")
    })

    it("orders modifiers the way each platform prints them", () => {
        const chord = modChord(key("z"), {shift: "required", alt: "required", ctrl: "required"})
        expect(formatChord(chord, {isMac: true})).toBe("⌃⌥⇧⌘Z")
        expect(formatChord(chord, {isMac: false})).toBe("Ctrl+Alt+Shift+Z")
    })

    it.each([
        ["Escape", "esc", "Esc"],
        ["Backspace", "⌫", "Backspace"],
        ["Delete", "⌦", "Delete"],
        ["ArrowLeft", "←", "←"],
        ["ArrowRight", "→", "→"],
        ["Tab", "⇥", "Tab"],
    ])("renders %s as %s on a Mac and %s elsewhere", (name, mac, other) => {
        expect(formatChord(bare(key(name)), {isMac: true})).toBe(mac)
        expect(formatChord(bare(key(name)), {isMac: false})).toBe(other)
    })
})
