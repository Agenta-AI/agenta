import {bare, key} from "../chord"
import {SECTION_IDS} from "../sections"

import {defineShortcuts, id} from "./helpers"

export const SLASH_COMMAND_SHORTCUTS = defineShortcuts([
    {
        // Typing `/` opens the menu from an editor update, not from a keydown — pasting one, or
        // moving the caret back into an existing run, opens it too. It carries no chord for that
        // reason, and is listed only so the reference can teach it.
        id: id("slash.open"),
        section: SECTION_IDS.slashCommands,
        chords: [],
        label: "Open the command menu",
        context: "type / at the start of a line or after a space",
        inlineHint: "never",
        order: 5,
    },
    {
        id: id("slash.move"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("ArrowDown")), bare(key("ArrowUp"))],
        label: "Move through commands",
        guards: {typing: "allow"},
        order: 10,
    },
    {
        id: id("slash.run"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("Enter")), bare(key("Tab"))],
        label: "Run the highlighted command",
        context: "declines when nothing matches, so the message sends",
        guards: {typing: "allow"},
        order: 11,
    },
    {
        id: id("slash.dismiss"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("Escape"))],
        label: "Dismiss the menu",
        guards: {typing: "allow"},
        order: 12,
    },
    // The keys below belong to the panel a command opens, not to the menu itself.
    {
        id: id("slash.picker.move"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("ArrowDown")), bare(key("ArrowUp"))],
        label: "Move through a picker's options",
        context: "inside the panel a command opened",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 20,
    },
    {
        id: id("slash.picker.edge"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("Home")), bare(key("End"))],
        label: "First or last option",
        context: "inside a picker",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 21,
    },
    {
        id: id("slash.picker.back"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("ArrowLeft"))],
        label: "Back to commands",
        context: "inside a picker, and only while its search box is empty",
        guards: {typing: "allow"},
        order: 22,
    },
    {
        id: id("slash.picker.intoModels"),
        section: SECTION_IDS.slashCommands,
        chords: [bare(key("ArrowRight")), bare(key("Enter"))],
        label: "Step into the model column",
        context: "on a provider row in the model picker",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 23,
    },
])
