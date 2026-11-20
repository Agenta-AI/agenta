import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

import {useAgentPanel} from "./agentPanelContext"

/** "Close" at the right end of the Configuration panel's header row (canvas S02: `i-x`, fg2). */
export const PanelCloseButton = () => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    return (
        <SimpleTooltip title={t("agentLayout.panel.close")}>
            <Button
                variant="ghost"
                size="icon-compact"
                aria-label={t("agentLayout.panel.close")}
                onClick={() => void panel.close()}
            >
                <X size={16} />
            </Button>
        </SimpleTooltip>
    )
}
