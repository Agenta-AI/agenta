import {altChord, bare, code, key} from "../chord"
import {SECTION_IDS} from "../sections"

import {defineShortcuts, id} from "./helpers"

/** How many open sessions the digit row can reach. */
export const SESSION_SHORTCUT_MAX = 9

const digitJump = Array.from({length: SESSION_SHORTCUT_MAX}, (_, index) => ({
    id: id(`session.jump.${index + 1}`),
    section: SECTION_IDS.sessions,
    chords: [altChord(code(`Digit${index + 1}`))],
    label: `Jump to session ${index + 1}`,
    // The chip surface for a session tab does not exist yet; the reference is where these live.
    inlineHint: "never" as const,
    order: 10 + index,
}))

export const SESSION_SHORTCUTS = defineShortcuts([
    ...digitJump,
    {
        id: id("session.previous"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyZ"))],
        label: "Previous session",
        inlineHint: "never",
        order: 20,
    },
    {
        id: id("session.next"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyX"))],
        label: "Next session",
        inlineHint: "never",
        order: 21,
    },
    {
        id: id("session.new"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyC"))],
        label: "New session",
        inlineHint: "never",
        order: 30,
    },
    {
        id: id("session.rename"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyR"))],
        label: "Rename session",
        inlineHint: "never",
        order: 31,
    },
    {
        id: id("session.archive"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyA"))],
        label: "Archive session",
        inlineHint: "never",
        order: 32,
    },
    {
        id: id("session.close"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyW"))],
        label: "Close session",
        context: "needs a second session to fall back to",
        inlineHint: "never",
        order: 33,
    },
    {
        id: id("session.search"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyF"))],
        label: "Search sessions",
        inlineHint: "never",
        order: 40,
    },
    {
        id: id("session.toggleConfigPanel"),
        section: SECTION_IDS.sessions,
        chords: [altChord(code("KeyB"))],
        label: "Toggle config panel",
        inlineHint: "never",
        order: 41,
    },
    {
        id: id("session.open"),
        section: SECTION_IDS.sessions,
        chords: [bare(key("Enter")), bare(key("Space"))],
        label: "Open session",
        context: "on a focused tab, rail row, or history row",
        inlineHint: "never",
        order: 50,
    },
    {
        id: id("session.menu"),
        section: SECTION_IDS.sessions,
        chords: [bare(key("ContextMenu")), bare(key("F10"), {shift: "required"})],
        label: "Open the session menu",
        context: "on a focused tab or row",
        inlineHint: "never",
        order: 51,
    },
    {
        id: id("session.renameCommit"),
        section: SECTION_IDS.sessions,
        chords: [bare(key("Enter"))],
        label: "Save the name",
        context: "while renaming",
        inlineHint: "never",
        order: 60,
    },
    {
        id: id("session.renameCancel"),
        section: SECTION_IDS.sessions,
        chords: [bare(key("Escape"))],
        label: "Discard the rename",
        context: "while renaming",
        inlineHint: "never",
        order: 61,
    },
])
