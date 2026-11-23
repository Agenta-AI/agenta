import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {useIsPhone} from "@agenta/ui/phone"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {AnalyticsTab} from "../settings/AnalyticsTab"

import {AgentListPageHeader} from "./AgentListPageHeader"
import {agentAnalyticsColumnClass} from "./analyticsColumn"
import {AGENT_PAGE_COLUMN} from "./configurationTabs"

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
    const t = useT(agentSidebarCatalog)
    const phone = useIsPhone()
    useBindProjectContext(projectId)
    return (
        <>
            <PageTitle title={t("agentSidebar.analytics")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <AgentListPageHeader
                            title={t("agentSidebar.analytics")}
                            workspaceId={workspaceId}
                            projectId={projectId}
                            column={AGENT_PAGE_COLUMN}
                        />
                    }
                >
                    <div className={agentAnalyticsColumnClass(phone)}>
                        <AnalyticsTab
                            workspaceId={workspaceId}
                            projectId={projectId}
                            lockedAgentId={agentId}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
