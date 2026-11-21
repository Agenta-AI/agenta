/**
 * The `/` command palette's spec — its trigger, its aria label, and the footer that names what
 * Enter will do for the highlighted row.
 */
import {createT} from "@agenta/i18n"
import uiChatInputCatalog from "@agenta/i18n/catalogs/ui.chatInput"

import {HintKey} from "../plugins/PalettePanel"

import type {PaletteItem, PaletteSpec} from "./palette"
import type {SlashCommandSection} from "./slashCommands"

const tNow = createT(uiChatInputCatalog)

const enterLabel = (item: PaletteItem | undefined) => {
    if (!item) return tNow("ui.chatInput.enterSend")
    if (item.kind === "open") return tNow("ui.chatInput.enterOpen")
    if (item.kind === "action") return tNow("ui.chatInput.enterRun")
    return tNow("ui.chatInput.enterInsert")
}

export const slashPaletteSpec = (sections: SlashCommandSection[]): PaletteSpec => ({
    key: "slash",
    trigger: "/",
    allowSlashInQuery: false,
    get label() {
        return tNow("ui.chatInput.commands")
    },
    sections,
    filterMode: "label",
    emptyText: (query) => tNow("ui.chatInput.noCommand", {query}),
    footer: (activeItem) => (
        <>
            <HintKey keys="↑↓" label={tNow("ui.chatInput.navigate")} />
            {/* Names what Enter actually does, including the empty state where the menu declines
                it and the message sends. */}
            <HintKey keys="↵" label={enterLabel(activeItem)} />
            <HintKey keys="esc" label={tNow("ui.chatInput.dismiss")} />
        </>
    ),
})
