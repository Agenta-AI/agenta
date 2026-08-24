/**
 * "Show configuration" trigger — reveals the config panel after it was collapsed via the config
 * header's collapse button. Only rendered while collapsed (see AgentChatPanel).
 */
import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDoubleRight} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

export default function ShowConfigPanelButton() {
    const setConfigPanelCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <SimpleTooltip title="Show configuration">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show configuration"
                onClick={() => setConfigPanelCollapsed(false)}
                className="h-7 w-7 shrink-0 p-0"
            >
                <CaretDoubleRight size={14} />
            </Button>
        </SimpleTooltip>
    )
}
