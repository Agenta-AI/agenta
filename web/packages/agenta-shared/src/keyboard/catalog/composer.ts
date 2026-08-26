import {bare, key, modChord} from "../chord"
import {SECTION_IDS} from "../sections"

import {defineShortcuts, id} from "./helpers"

export const COMPOSER_SHORTCUTS = defineShortcuts([
    {
        id: id("composer.send"),
        section: SECTION_IDS.composer,
        chords: [bare(key("Enter"))],
        label: "Send message",
        guards: {typing: "allow"},
        order: 10,
    },
    {
        id: id("composer.newline"),
        section: SECTION_IDS.composer,
        chords: [bare(key("Enter"), {shift: "required"}), modChord(key("Enter"))],
        label: "Insert newline",
        guards: {typing: "allow"},
        order: 11,
    },
    {
        id: id("composer.codeBlock"),
        section: SECTION_IDS.composer,
        chords: [bare(key("Enter"))],
        label: "Start a code block",
        context: "on a line holding only a fence",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 12,
    },
    {
        id: id("composer.indent"),
        section: SECTION_IDS.composer,
        chords: [bare(key("Tab"))],
        label: "Indent a list item",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 20,
    },
    {
        id: id("composer.outdent"),
        section: SECTION_IDS.composer,
        chords: [bare(key("Tab"), {shift: "required"})],
        label: "Outdent a list item",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 21,
    },
    // Lexical's RichTextExtension registers these; the composer deliberately shows no chip for
    // them, which is exactly why the reference has to.
    {
        id: id("composer.bold"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("b"))],
        label: "Bold",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 30,
    },
    {
        id: id("composer.italic"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("i"))],
        label: "Italic",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 31,
    },
    {
        id: id("composer.underline"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("u"))],
        label: "Underline",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 32,
    },
    {
        id: id("composer.undo"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("z"))],
        label: "Undo",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 40,
    },
    {
        // Lexical accepts Ctrl+Y as well as Ctrl+Shift+Z off Apple hardware; both are listed so
        // the reference matches what the editor actually answers.
        id: id("composer.redo"),
        section: SECTION_IDS.composer,
        chords: [
            modChord(key("z"), {shift: "required"}),
            bare(key("y"), {ctrl: "required", only: "other"}),
        ],
        label: "Redo",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 41,
    },
    {
        id: id("composer.attachFromClipboard"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("v"))],
        label: "Attach files from the clipboard",
        context: "with files on the clipboard",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 50,
    },
    {
        id: id("composer.linkSelection"),
        section: SECTION_IDS.composer,
        chords: [modChord(key("v"))],
        label: "Link the selection",
        context: "with a lone URL on the clipboard, over a selection",
        inlineHint: "never",
        guards: {typing: "allow"},
        order: 51,
    },
])
