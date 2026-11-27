import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

/** "Close" at the right end of the agent pane's header row (canvas S02: `i-x`, fg2). */
export const PanelCloseButton = ({onClose}: {onClose: () => void}) => {
    const t = useT(agentLayoutPanelCatalog)
    return (
        <SimpleTooltip title={t("agentLayout.panel.close")}>
            <Button
                variant="ghost"
                size="icon-compact"
                aria-label={t("agentLayout.panel.close")}
                onClick={onClose}
            >
                <X size={16} />
            </Button>
        </SimpleTooltip>
    )
}
