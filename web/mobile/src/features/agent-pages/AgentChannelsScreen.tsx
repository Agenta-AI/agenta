import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {useIsPhone} from "@agenta/ui/phone"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

import {AgentChannels} from "./AgentChannels"
import {AGENT_CHANNELS_PAGE_COLUMN, AgentListPageHeader} from "./AgentListPageHeader"

/** The Channels page of one agent. */
export const AgentChannelsScreen = ({
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
            <PageTitle title={t("agentSidebar.channels")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <AgentListPageHeader
                            title={t("agentSidebar.channels")}
                            workspaceId={workspaceId}
                            projectId={projectId}
                        />
                    }
                >
                    <div
                        className={
                            phone
                                ? // On a phone the channel rows run edge to edge (M13).
                                  `min-w-0 pb-12 ${SESSIONS_PAGE_FRAME}`
                                : AGENT_CHANNELS_PAGE_COLUMN
                        }
                    >
                        <AgentChannels agentId={agentId} />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
