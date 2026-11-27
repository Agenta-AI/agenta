import {useT} from "@agenta/i18n"
import agentPagesPageCatalog from "@agenta/i18n/catalogs/agentPages.page"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"
import {AnalyticsTab} from "../settings/AnalyticsTab"

import {AgentBuilderButton} from "./AgentBuilderButton"

/** The Analytics page of one agent (A09): today's Analytics page, locked to the agent. */
export const AgentAnalyticsScreen = ({
    workspaceId,
    projectId,
    agentId,
}: {
    workspaceId: string
    projectId: string
    agentId: string
}) => {
    const t = useT(agentSidebarCatalog, agentPagesPageCatalog)
    useBindProjectContext(projectId)
    return (
        <PageLayout
            workspaceId={workspaceId}
            projectId={projectId}
            title={t("agentSidebar.analytics")}
            description={t("agentPages.page.analyticsDescription")}
            actions={<AgentBuilderButton />}
        >
            <AnalyticsTab workspaceId={workspaceId} projectId={projectId} lockedAgentId={agentId} />
        </PageLayout>
    )
}
