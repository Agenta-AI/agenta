import {describe, expect, it} from "vitest"

import {
    PLAYGROUND_SHORTCUTS,
    SHORTCUT_GROUP_TITLES,
    getShortcut,
    shortcutAria,
    shortcutFaces,
    shortcutGroups,
    shortcutText,
} from "../../src/utils/shortcuts"
import type {ShortcutGroupId} from "../../src/utils/shortcuts"

describe("the shortcut registry", () => {
    it("gives every entry a unique id", () => {
        const ids = PLAYGROUND_SHORTCUTS.map((shortcut) => shortcut.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it("puts every entry in a titled group, and titles no empty group", () => {
        const used = new Set(PLAYGROUND_SHORTCUTS.map((shortcut) => shortcut.group))
        const titled = new Set(Object.keys(SHORTCUT_GROUP_TITLES) as ShortcutGroupId[])
        for (const group of used) expect(titled.has(group)).toBe(true)
        for (const group of titled) expect(used.has(group)).toBe(true)
    })

    it("lists every entry exactly once across the groups", () => {
        const listed = shortcutGroups().flatMap((group) => group.shortcuts)
        expect(listed).toHaveLength(PLAYGROUND_SHORTCUTS.length)
    })

    // A key face reaches the screen verbatim. An empty one would render a blank cap.
    it("gives every entry a key face, except the chord that is modifiers only", () => {
        for (const shortcut of PLAYGROUND_SHORTCUTS) {
            if (shortcut.key === "") {
                expect(shortcut.modifiers?.length).toBeGreaterThan(0)
                continue
            }
            expect(shortcut.key.length).toBeGreaterThan(0)
        }
    })
})

describe("printing a chord", () => {
    it("prints Apple glyphs on Apple hardware and words everywhere else", () => {
        const approve = getShortcut("approval.approve")!
        expect(shortcutFaces(approve, true)).toEqual(["⌘", "↵"])
        expect(shortcutFaces(approve, false)).toEqual(["Ctrl", "↵"])
    })

    it("joins with a plus off Apple hardware and with nothing on it", () => {
        const session = getShortcut("session.new")!
        expect(shortcutText(session, false)).toBe("Alt+N")
        expect(shortcutText(session, true)).toBe("⌥N")
    })

    it("prints the modifiers alone when the chord is a hold with no key", () => {
        const hold = getShortcut("voice.hold")!
        expect(shortcutFaces(hold, false)).toEqual(["Ctrl", "Alt"])
    })
})

describe("aria-keyshortcuts", () => {
    // The attribute wants ARIA key names, not the display glyphs the keycaps show.
    it("translates a glyph to its ARIA name", () => {
        expect(shortcutAria("approval.deny")).toBe("Escape")
        expect(shortcutAria("rename.commit")).toBe("Enter")
        expect(shortcutAria("picker.back")).toBe("ArrowLeft")
    })

    it("expands the platform modifier to both of its ARIA names", () => {
        expect(shortcutAria("approval.approve")).toBe("Meta+Enter Control+Enter")
    })

    it("includes the mirror chord", () => {
        expect(shortcutAria("session.step")).toBe("Alt+Z Alt+X")
    })

    it("says nothing for a range that names no single key", () => {
        expect(shortcutAria("session.jump")).toBe("")
    })

    it("says nothing for an id the registry does not hold", () => {
        expect(shortcutAria("nope.missing")).toBe("")
    })

    // A value the browser cannot parse is worse than no attribute, so keep the shape strict.
    it("emits only ARIA modifier names and single key names", () => {
        const allowedModifiers = new Set(["Meta", "Control", "Alt", "Shift"])
        for (const shortcut of PLAYGROUND_SHORTCUTS) {
            const value = shortcutAria(shortcut.id)
            if (!value) continue
            for (const chord of value.split(" ")) {
                const parts = chord.split("+")
                const key = parts.pop()!
                expect(key).not.toBe("")
                for (const modifier of parts) expect(allowedModifiers.has(modifier)).toBe(true)
            }
        }
    })
})
