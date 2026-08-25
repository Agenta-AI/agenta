import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {ChevronsRight} from "lucide-react"

/**
 * The `»` that brings the collapsed config pane back.
 *
 * Its own component because it has two homes: the tab rail's `leadingExtra`, where the pane
 * disappeared from, and — on a surface with no tab rail — the workspace column itself. It was
 * only ever in the rail, so hiding the rail took the only way back with it.
 */
export const ConfigRevealButton = () => {
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <SimpleTooltip title="Show configuration">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show configuration"
                onClick={() => setConfigCollapsed(false)}
                className="h-7 w-7 shrink-0 p-0"
            >
                <ChevronsRight size={14} />
            </Button>
        </SimpleTooltip>
    )
}
