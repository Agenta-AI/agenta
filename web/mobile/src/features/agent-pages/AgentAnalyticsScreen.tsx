import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {useIsPhone} from "@agenta/ui/phone"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"
import {AnalyticsTab} from "../settings/AnalyticsTab"

import {AGENT_ANALYTICS_PAGE_COLUMN, AgentListPageHeader} from "./AgentListPageHeader"

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
                        />
                    }
                >
                    <div
                        className={
                            phone
                                ? `min-w-0 px-4 pb-12 pt-3 ${SESSIONS_PAGE_FRAME}`
                                : AGENT_ANALYTICS_PAGE_COLUMN
                        }
                    >
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
