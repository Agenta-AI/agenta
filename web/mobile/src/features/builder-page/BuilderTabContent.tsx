import {useEffect} from "react"

import {useAutomationEditor} from "@agenta/automation-ui"
import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SkeletonBlock} from "@agenta/ui/ui"
import {DrawerViewChrome, useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {automationView} from "../automations/automationView"

import {AgentPane} from "./AgentPane"
import type {BuilderTab} from "./builderTabs"

const Notice = ({children}: {children: string}) => (
    <p className="m-0 p-4 text-[13px] text-colorTextSecondary">{children}</p>
)

/** An agent tab: its pane tabs, or the no-access line when it was deleted or hidden. */
const AgentTab = ({
    agentId,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    agentId: string
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
        return <Notice>{t("builder.page.noAccess")}</Notice>
    return (
        <AgentPane
            agentId={agentId}
            builderSessionId={builderSessionId}
            workspaceId={workspaceId}
            projectId={projectId}
        />
    )
}

/** Opens the automation view as soon as the automation's kind is known. */
const AutomationTabRoot = ({
    automationId,
    workspaceId,
    projectId,
}: {
    automationId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    const stack = useViewStack()
    const editor = useAutomationEditor(automationId)
    const kind = editor.automation?.kind
    useEffect(() => {
        if (kind)
            void stack.open(
                automationView,
                {automationId, kind, workspaceId, projectId},
                {kind: "project"},
            )
        // Opened once per automation; the stack keeps it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automationId, kind])
    if (editor.missing) return <Notice>{t("builder.page.noAccess")}</Notice>
    if (!kind)
        return (
            <div className="flex flex-col gap-3 p-4" aria-busy>
                <SkeletonBlock active className="h-12 w-full" />
                <SkeletonBlock active className="h-24 w-full" />
            </div>
        )
    return null
}

/**
 * The view of the active builder tab. An agent tab shows the agent's pane tabs, an automation tab
 * the automation view. A tool tab and an app tab show a line until their views exist
 * (OPEN-QUESTIONS 3.24).
 */
export const BuilderTabContent = ({
    tab,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    tab: BuilderTab
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    if (tab.kind === "agent")
        return (
            <AgentTab
                agentId={tab.id}
                builderSessionId={builderSessionId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    if (tab.kind === "automation")
        return (
            <ViewStackHost
                chrome={DrawerViewChrome}
                rootTitle={tab.name || t("builder.page.kindAutomation")}
            >
                <AutomationTabRoot
                    automationId={tab.id}
                    workspaceId={workspaceId}
                    projectId={projectId}
                />
            </ViewStackHost>
        )
    return <Notice>{t("builder.page.itemNotShown")}</Notice>
}
