import {describe, expect, it} from "vitest"

import {SHORTCUTS} from "../../../src/keyboard/catalog"
import {describeShortcut, listShortcutSections} from "../../../src/keyboard/registry"
import {SECTION_IDS} from "../../../src/keyboard/sections"

const listed = SHORTCUTS.filter((def) => def.reference !== "hidden")

describe("labels a user reads", () => {
    it.each(listed.map((def) => [def.id, def.label] as const))(
        "%s reads as a plain action name",
        (_id, label) => {
            expect(label.trim()).not.toBe("")
            expect(label.endsWith(".")).toBe(false)
            // A label sits beside its own keycap; repeating the key inside it reads twice.
            expect(label).not.toMatch(/[⌘⌥⇧⌃↵⌫⌦→←↑↓]|Ctrl\+|Alt\+|Shift\+/)
            // "Focus SessionRail search" is the failure this catches.
            expect(label).not.toMatch(/\b[a-z]+[A-Z]\w*\b/)
        },
    )
})

describe("listShortcutSections", () => {
    it("returns sections in their declared order", () => {
        const sections = listShortcutSections({isMac: true})
        const orders = sections.map((section) => section.id)
        expect(orders[0]).toBe(SECTION_IDS.sessions)
        expect(orders).toContain(SECTION_IDS.agentGates)
    })

    it("drops sections the filter emptied, rather than leaving a bare heading", () => {
        const sections = listShortcutSections({isMac: true, sections: [SECTION_IDS.composer]})
        expect(sections).toHaveLength(1)
        expect(sections[0].id).toBe(SECTION_IDS.composer)
    })

    it("formats every listed chord for the platform asked for", () => {
        const mac = listShortcutSections({isMac: true})
        const win = listShortcutSections({isMac: false})
        const chordsOf = (sections: ReturnType<typeof listShortcutSections>) =>
            sections.flatMap((section) => section.shortcuts.flatMap((entry) => entry.chords))

        chordsOf(mac).forEach((chord) => expect(chord.trim()).not.toBe(""))
        expect(chordsOf(mac)).toContain("⌘↵")
        expect(chordsOf(win)).toContain("Ctrl+Enter")
        // The bug the registry exists to prevent: a literal ⌘ printed on Windows.
        expect(chordsOf(win).join(" ")).not.toMatch(/[⌘⌥⇧⌃]/)
    })

    it("sorts entries within a section by their declared order", () => {
        const [sessions] = listShortcutSections({isMac: true, sections: [SECTION_IDS.sessions]})
        expect(sessions.shortcuts[0].label).toBe("Jump to session 1")
        expect(sessions.shortcuts[8].label).toBe("Jump to session 9")
    })

    it("agrees with describeShortcut for the same entry", () => {
        const [composer] = listShortcutSections({isMac: true, sections: [SECTION_IDS.composer]})
        const first = composer.shortcuts[0]
        expect(describeShortcut(first.id, {isMac: true})).toEqual(first)
    })
})

describe("the reference listing", () => {
    it("matches its snapshot on a Mac", () => {
        expect(listShortcutSections({isMac: true})).toMatchSnapshot()
    })

    it("matches its snapshot on Windows", () => {
        expect(listShortcutSections({isMac: false})).toMatchSnapshot()
    })
})
