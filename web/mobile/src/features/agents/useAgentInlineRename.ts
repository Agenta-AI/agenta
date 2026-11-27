import {useCallback} from "react"

import {useRenameAgent} from "@agenta/entity-ui/agent"
import {useDeferredMenuSelect, useInlineRename} from "@agenta/sessions-ui"

/** The editor, drawn as the mobile input so the name being edited sits where the name was. */
export const AGENT_RENAME_INPUT_CLASS =
    "h-7 w-full min-w-0 rounded-md border border-solid border-border bg-background px-2 text-body leading-none text-foreground outline-none transition-colors [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus-ring-field"

/**
 * Renaming an agent IN PLACE, the way a session row renames — the editor, and the menu entry
 * that starts it. One hook for the agent rows, the agent cards and the session header's agent menu.
 *
 * The editor must not mount inside the menu's focus trap — Radix would restore focus to the
 * trigger as the menu closes, and a blur commits — so the verb runs from the close instead.
 */
export const useAgentInlineRename = (agent: {id: string; name: string}) => {
    const renameAgent = useRenameAgent()
    const onCommit = useCallback(
        (name: string) => renameAgent(agent.id, name),
        [renameAgent, agent.id],
    )
    // `useRenameAgent` shows the one error toast.
    const rename = useInlineRename({current: agent.name, onCommit, errorText: null})
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect((key) => {
        if (key === "rename") return () => rename.start()
    })
    return {rename, startFromMenu: () => handleSelect("rename"), handleCloseAutoFocus}
}
