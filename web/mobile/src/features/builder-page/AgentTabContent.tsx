import type {MutableRefObject} from "react"

import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {
    agentWorkflowsListQueryStateAtom,
    invalidateWorkflowsListCache,
} from "@agenta/entities/workflow"
import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import type {PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"

import {AgentPane} from "./AgentPane"
import {PaneNotice} from "./PaneNotice"

/** An agent tab: its pane tabs, or the no-access line when it was deleted or hidden. */
export const AgentTabContent = ({
    agentId,
    builderSaveToolCallId,
    changedSections,
    onSectionOpened,
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    agentId: string
    builderSaveToolCallId: string | null
    changedSections?: MarkableSectionKey[]
    onSectionOpened: (section: MarkableSectionKey) => void
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const sharing = useAtomValue(agentSharingQueryAtomFamily(agentId))
    const listed = (agents.data ?? []).some((agent) => agent.id === agentId)
    // The agent list could not load: a load error with retry, not "no access".
    if (agents.isError && !agents.data?.length)
        return (
            <div className="p-4">
                <LoadError
                    framed
                    title={t("builder.page.agentsFailed")}
                    onRetry={() => invalidateWorkflowsListCache()}
                />
            </div>
        )
    // The agent list does not hold it and its access read fails.
    if (!agents.isPending && !listed && sharing.isError)
        return <PaneNotice>{t("builder.page.noAccess")}</PaneNotice>
    return (
        <AgentPane
            agentId={agentId}
            builderSaveToolCallId={builderSaveToolCallId}
            changedSections={changedSections}
            onSectionOpened={onSectionOpened}
            guardRef={guardRef}
            builderSessionId={builderSessionId}
            workspaceId={workspaceId}
            projectId={projectId}
        />
    )
}
