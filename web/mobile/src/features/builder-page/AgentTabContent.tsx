import type {MutableRefObject} from "react"

import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {useAtomValue} from "jotai"

import type {PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"

import {AgentPane} from "./AgentPane"
import {PaneNotice} from "./PaneNotice"

/** An agent tab: its pane tabs, or the no-access line when it was deleted or hidden. */
export const AgentTabContent = ({
    agentId,
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    agentId: string
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const sharing = useAtomValue(agentSharingQueryAtomFamily(agentId))
    const listed = (agents.data ?? []).some((agent) => agent.id === agentId)
    // The agent list does not hold it and its access read fails.
    if (!agents.isPending && !listed && sharing.isError)
        return <PaneNotice>{t("builder.page.noAccess")}</PaneNotice>
    return (
        <AgentPane
            agentId={agentId}
            guardRef={guardRef}
            builderSessionId={builderSessionId}
            workspaceId={workspaceId}
            projectId={projectId}
        />
    )
}
