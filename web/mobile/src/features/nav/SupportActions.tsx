import {useCallback, useState} from "react"

import {SidebarIconMenu} from "@agenta/navigation-ui"
import {KeyboardShortcutsSheet} from "@agenta/ui/shortcuts"

import {LiveChatNavButton} from "../support/LiveChatNavButton"
import {useLiveChatEnabled} from "../support/useLiveChatEnabled"

import {useMobileHelpItem} from "./useMobileNavItems"

/** Live chat and Help & Docs, as the rail's icon buttons; the parent lays them out. */
export const SupportActions = ({projectId}: {projectId: string}) => {
    // The sheet is a modal, so its state lives with whatever stays mounted after the menu closes.
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const helpItem = useMobileHelpItem({
        onOpenShortcuts: useCallback(() => setShortcutsOpen(true), []),
    })
    const liveChatEnabled = useLiveChatEnabled(projectId)

    return (
        <>
            {liveChatEnabled ? <LiveChatNavButton /> : null}
            <SidebarIconMenu item={helpItem} />
            <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </>
    )
}
