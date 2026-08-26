import {bare, code, key, modChord} from "../chord"
import {SECTION_IDS} from "../sections"

import {defineShortcuts, id} from "./helpers"

/** How many option rows the digit row can reach. */
export const MAX_DIGIT_ROWS = 9

const digitPick = Array.from({length: MAX_DIGIT_ROWS}, (_, index) => ({
    id: id(`gate.option.pick.${index + 1}`),
    section: SECTION_IDS.agentGates,
    chords: [bare(code(`Digit${index + 1}`))],
    label: `Pick option ${index + 1}`,
    context: "in the option list",
    inlineHint: "never" as const,
    order: 60 + index,
}))

/** The three docks that interrupt a run — approval, question, connection — plus the recording
 * bar. One section because they are one moment to a user, whatever the component tree says. */
export const AGENT_GATE_SHORTCUTS = defineShortcuts([
    {
        id: id("gate.approve"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("Enter"))],
        label: "Approve",
        context: "while an approval is waiting",
        // Mirrors the composer's send, so it stays live from a focused field.
        guards: {typing: "allow-with-mod"},
        order: 10,
    },
    {
        id: id("gate.deny"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Escape"))],
        label: "Deny",
        context: "while an approval is waiting",
        order: 11,
    },
    {
        id: id("gate.question.primary"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("Enter"))],
        label: "Next question, or accept",
        context: "in a question card",
        guards: {typing: "allow-with-mod"},
        order: 20,
    },
    {
        id: id("gate.question.back"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("ArrowLeft"))],
        label: "Previous question",
        context: "in a question card",
        inlineHint: "never",
        guards: {typing: "allow-with-mod"},
        order: 21,
    },
    {
        id: id("gate.question.forward"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("ArrowRight"))],
        label: "Next question",
        context: "in a question card",
        inlineHint: "never",
        guards: {typing: "allow-with-mod"},
        order: 22,
    },
    {
        id: id("gate.question.skip"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("Backspace")), modChord(key("Delete"))],
        label: "Skip question",
        context: "in a question card",
        inlineHint: "never",
        guards: {typing: "allow-with-mod"},
        order: 23,
    },
    {
        id: id("gate.question.cancelHold"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Escape"))],
        label: "Cancel a pending pick",
        context: "while a pick is held",
        inlineHint: "never",
        order: 24,
    },
    {
        // Deliberately never settles the card — it backs out of typing, and that divergence from
        // the approval and connection docks is documented at the dock itself.
        id: id("gate.question.blur"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Escape"))],
        label: "Back out of a field",
        context: "in a question card — does not answer it",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 25,
    },
    ...digitPick,
    {
        id: id("gate.option.move"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("ArrowDown")), bare(key("ArrowUp"))],
        label: "Move through options",
        context: "in the option list",
        order: 70,
    },
    {
        id: id("gate.option.edge"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Home")), bare(key("End"))],
        label: "First or last option",
        context: "in the option list",
        inlineHint: "never",
        order: 71,
    },
    {
        id: id("gate.option.toggle"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Space"))],
        label: "Toggle option",
        context: "multi-select lists only",
        inlineHint: "never",
        order: 72,
    },
    {
        id: id("gate.option.choose"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Enter"))],
        label: "Choose the highlighted option",
        context: "in the option list",
        order: 73,
    },
    {
        id: id("gate.answer.submit"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Enter"))],
        label: "Submit answer",
        context: "in a single-line answer field",
        guards: {typing: "allow"},
        order: 80,
    },
    {
        id: id("gate.review.edit"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Enter"))],
        label: "Edit an answer",
        context: "on the review screen",
        inlineHint: "never",
        order: 81,
    },
    {
        id: id("gate.connect"),
        section: SECTION_IDS.agentGates,
        chords: [modChord(key("Enter"))],
        label: "Connect",
        context: "while a connection is requested",
        guards: {typing: "allow-with-mod"},
        order: 90,
    },
    {
        id: id("gate.connect.decline"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Escape"))],
        label: "Decline, or cancel connecting",
        context: "while a connection is requested",
        order: 91,
    },
    {
        id: id("gate.recording.discard"),
        section: SECTION_IDS.agentGates,
        chords: [bare(key("Escape"))],
        label: "Discard recording",
        context: "while recording",
        inlineHint: "never",
        order: 95,
    },
])
