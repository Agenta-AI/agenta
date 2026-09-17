import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {ChevronsRight} from "lucide-react"

/**
 * The `»` that brings the collapsed config pane back.
 *
 * Its own component so the tab rail is not the only thing that can offer it. A surface with no
 * tab rail uses [[CollapsedConfigRail]] instead, which has the room to say what it opens.
 */
export const ConfigRevealButton = () => {
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <SimpleTooltip
            title={
                <span className="flex items-center gap-1.5">
                    Show configuration <ShortcutKeys id="panel.config" tone="inverse" />
                </span>
            }
        >
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show configuration"
                aria-keyshortcuts={shortcutAria("panel.config")}
                onClick={() => setConfigCollapsed(false)}
                className="h-7 w-7 shrink-0 p-0"
            >
                <ChevronsRight size={14} />
            </Button>
        </SimpleTooltip>
    )
}
