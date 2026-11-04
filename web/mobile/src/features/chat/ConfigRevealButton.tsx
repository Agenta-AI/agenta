import {revealConfigPaneAtom} from "@agenta/chat/state"
import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Sidebar} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Floats at the conversation's top-left and brings the collapsed config pane back. First run
 * uses [[CollapsedConfigRail]] instead, which has the room to say what it opens.
 */
export const ConfigRevealButton = () => {
    const revealConfig = useSetAtom(revealConfigPaneAtom)

    return (
        <SimpleTooltip
            title={
                <span className="flex items-center gap-1.5">
                    Show configuration <ShortcutKeys id="panel.config" tone="inverse" />
                </span>
            }
        >
            <Button
                variant="outline"
                size="icon-sm"
                aria-label="Show configuration"
                aria-keyshortcuts={shortcutAria("panel.config")}
                onClick={() => revealConfig()}
            >
                <Sidebar />
            </Button>
        </SimpleTooltip>
    )
}
