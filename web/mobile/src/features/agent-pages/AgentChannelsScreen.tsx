import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentChannels} from "./AgentChannels"

/** The Channels page of one agent (A07, A08). */
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
    useBindProjectContext(projectId)
    return (
        <>
            <PageTitle title={t("agentSidebar.channels")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto box-border w-full max-w-[720px] shrink-0 px-4 pb-3 pt-3 lg:pt-14">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    {t("agentSidebar.channels")}
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div className="mx-auto w-full min-w-0 max-w-[720px] px-4 pb-12 pt-3">
                        <AgentChannels agentId={agentId} />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
