import {useCallback} from "react"

import {useRenameAgent} from "@agenta/entity-ui/agent"
import {useDeferredMenuSelect, useInlineRename} from "@agenta/sessions-ui"

import type {AgentListRow} from "./agentListView"

/** The editor, drawn as the mobile input so the name being edited sits where the name was. */
export const AGENT_RENAME_INPUT_CLASS =
    "h-7 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[14px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"

/**
 * Renaming an agent IN PLACE, the way a session row renames — the editor, and the menu entry
 * that starts it. One hook, because a row and a card both hold this state and must start the
 * same editor from the same kebab.
 *
 * The editor must not mount inside the menu's focus trap — Radix would restore focus to the
 * trigger as the menu closes, and a blur commits — so the verb runs from the close instead.
 */
export const useAgentInlineRename = (row: AgentListRow) => {
    const renameAgent = useRenameAgent()
    const onCommit = useCallback((name: string) => renameAgent(row.id, name), [renameAgent, row.id])
    const rename = useInlineRename({
        current: row.name,
        onCommit,
        errorText: "Couldn't rename this agent",
    })
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect((key) => {
        if (key === "rename") return () => rename.start()
    })
    return {rename, startFromMenu: () => handleSelect("rename"), handleCloseAutoFocus}
}
