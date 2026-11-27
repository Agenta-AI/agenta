import {useT} from "@agenta/i18n"
import agentPagesChannelsCatalog from "@agenta/i18n/catalogs/agentPages.channels"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import channelsPageCatalog from "@agenta/i18n/catalogs/channels.page"
import {useIsPhone} from "@agenta/ui/phone"

import {useAgentRow} from "../agent-layout/useAgentRow"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"

import {AgentBuilderButton} from "./AgentBuilderButton"
import {AgentChannels} from "./AgentChannels"

/** The Channels page of one agent: the Settings channel grid for this agent. */
export const AgentChannelsScreen = ({
    workspaceId,
    projectId,
    agentId,
}: {
    workspaceId: string
    projectId: string
    agentId: string
}) => {
    const t = useT(agentSidebarCatalog, agentPagesChannelsCatalog, channelsPageCatalog)
    const phone = useIsPhone()
    useBindProjectContext(projectId)
    const {row} = useAgentRow(agentId)
    const agent = row?.name || row?.slug || t("channels.page.yourAgent")
    return (
        <PageLayout
            workspaceId={workspaceId}
            projectId={projectId}
            title={t("agentSidebar.channels")}
            description={t("agentPages.channels.intro", {agent})}
            actions={<AgentBuilderButton />}
        >
            {/* On a phone the channel rows run edge to edge (M13). */}
            <div className={phone ? "-mx-4" : undefined}>
                <AgentChannels
                    agentId={agentId}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    page
                />
            </div>
        </PageLayout>
    )
}
