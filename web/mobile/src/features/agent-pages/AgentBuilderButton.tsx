import {useContext} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {Button} from "@agenta/ui/ui"

import {useOpenAgentBuilder} from "../agent-layout/AgentPageBuilderHost"
import {AgentPanelContext} from "../agent-layout/agentPanelContext"

/** An agent page's title action: opens or closes this agent's Builder in the right panel. */
export const AgentBuilderButton = () => {
    const t = useT(agentLayoutHeaderCatalog)
    const openBuilder = useOpenAgentBuilder()
    const panel = useContext(AgentPanelContext)
    if (!openBuilder) return null
    return (
        <Button variant="outline" aria-pressed={panel?.content === "builder"} onClick={openBuilder}>
            <BuilderIcon data-icon="inline-start" />
            {t("agentLayout.header.builder")}
        </Button>
    )
}
