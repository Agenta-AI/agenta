import type {Chord} from "./types"

/**
 * Keys whose own name reads badly on a keycap, per platform. Apple keyboards print the symbol;
 * everywhere else the word is what is actually on the key. Anything absent prints as-is.
 */
const KEY_GLYPHS: Record<string, {mac: string; other: string}> = {
    enter: {mac: "↵", other: "Enter"},
    escape: {mac: "esc", other: "Esc"},
    space: {mac: "Space", other: "Space"},
    tab: {mac: "⇥", other: "Tab"},
    backspace: {mac: "⌫", other: "Backspace"},
    delete: {mac: "⌦", other: "Delete"},
    arrowup: {mac: "↑", other: "↑"},
    arrowdown: {mac: "↓", other: "↓"},
    arrowleft: {mac: "←", other: "←"},
    arrowright: {mac: "→", other: "→"},
}

/** The `event.code` values the catalog uses, back to the character printed on the key. */
const codeGlyph = (rawCode: string): string => {
    const digit = /^Digit([0-9])$/.exec(rawCode)
    if (digit) return digit[1]
    const letter = /^Key([A-Z])$/.exec(rawCode)
    if (letter) return letter[1]
    return rawCode
}

const targetGlyph = (chord: Chord, isMac: boolean): string => {
    if (chord.target.kind === "physical") return codeGlyph(chord.target.code)
    const lower = chord.target.key.toLowerCase()
    const glyph = KEY_GLYPHS[lower === " " ? "space" : lower]
    if (glyph) return isMac ? glyph.mac : glyph.other
    // A single character reads as a keycap in upper case; a named key keeps the name it was given.
    return chord.target.key.length === 1 ? chord.target.key.toUpperCase() : chord.target.key
}

/**
 * One chord, spelled the way this platform's keyboard spells it: `⌘↵` on a Mac, `Ctrl+Enter`
 * everywhere else. Modifier order is the platform's own — `⌃⌥⇧⌘` on Apple, `Ctrl+Alt+Shift+`
 * elsewhere — and the separator belongs here, not at the call sites, or `⌥R` reads correctly on
 * a Mac while every other platform prints `AltR`.
 */
export function formatChord(chord: Chord, opts: {isMac: boolean}): string {
    const {isMac} = opts
    const wantsMeta = chord.meta === "required" || (isMac && chord.mod === "required")
    const wantsCtrl = chord.ctrl === "required" || (!isMac && chord.mod === "required")

    const parts: string[] = []
    if (isMac) {
        if (wantsCtrl) parts.push("⌃")
        if (chord.alt === "required") parts.push("⌥")
        if (chord.shift === "required") parts.push("⇧")
        if (wantsMeta) parts.push("⌘")
    } else {
        if (wantsCtrl) parts.push("Ctrl")
        if (wantsMeta) parts.push("Meta")
        if (chord.alt === "required") parts.push("Alt")
        if (chord.shift === "required") parts.push("Shift")
    }

    parts.push(targetGlyph(chord, isMac))
    return isMac ? parts.join("") : parts.join("+")
}
