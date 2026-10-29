/**
 * The `/` command palette's spec — its trigger, its aria label, and the footer that names what
 * Enter will do for the highlighted row.
 */
import {HintKey} from "../plugins/PalettePanel"

import type {PaletteItem, PaletteSpec} from "./palette"
import type {SlashCommandSection} from "./slashCommands"

const enterLabel = (item: PaletteItem | undefined) => {
    if (!item) return "send"
    if (item.kind === "open") return "open"
    if (item.kind === "action") return "run"
    return "insert"
}

export const slashPaletteSpec = (sections: SlashCommandSection[]): PaletteSpec => ({
    key: "slash",
    trigger: "/",
    allowSlashInQuery: false,
    label: "Commands",
    sections,
    filterMode: "label",
    emptyText: (query) => `No command or skill matches “${query}”`,
    footer: (activeItem) => (
        <>
            <HintKey keys="↑↓" label="navigate" />
            {/* Names what Enter actually does, including the empty state where the menu declines
                it and the message sends. */}
            <HintKey keys="↵" label={enterLabel(activeItem)} />
            <HintKey keys="esc" label="dismiss" />
        </>
    ),
})
