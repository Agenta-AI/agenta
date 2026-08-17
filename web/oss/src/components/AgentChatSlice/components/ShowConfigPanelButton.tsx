/**
 * "Show configuration" trigger — reveals the config panel after it was collapsed via the config
 * header's collapse button. Only rendered while collapsed (see AgentChatPanel).
 */
import {CaretDoubleRight} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {configPanelCollapsedAtom} from "@agenta/chat/state"

export default function ShowConfigPanelButton() {
    const setConfigPanelCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <Tooltip title="Show configuration">
            <Button
                type="text"
                size="small"
                icon={<CaretDoubleRight size={14} />}
                onClick={() => setConfigPanelCollapsed(false)}
                aria-label="Show configuration"
            />
        </Tooltip>
    )
}
