import {useEffect, type MutableRefObject} from "react"

import {useAutomationEditor} from "@agenta/automation-ui"
import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"
import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SkeletonBlock} from "@agenta/ui/ui"
import {DrawerViewChrome, useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {PageViewStackGuard, type PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"
import {automationView} from "../automations/automationView"

import {AgentPane} from "./AgentPane"
import type {BuilderTab} from "./builderTabs"

const Notice = ({children}: {children: string}) => (
    <p className="m-0 p-4 text-[13px] text-colorTextSecondary">{children}</p>
)

/** An agent tab: its pane tabs, or the no-access line when it was deleted or hidden. */
const AgentTab = ({
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
    // The agent list does not hold it and its access read fails.
    if (!agents.isPending && !listed && sharing.isError)
        return <Notice>{t("builder.page.noAccess")}</Notice>
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
    // The automation view is the tab's only content: it opens once the kind is known, and again
    // when Done, Escape or the root crumb leaves it.
    const atRoot = stack.depth === 0
    useEffect(() => {
        if (kind && atRoot)
            void stack.open(
                automationView,
                {automationId, kind, workspaceId, projectId},
                {kind: "project"},
            )
        // stack is a new object on each change; atRoot is the dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automationId, kind, atRoot])
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
 * (OPEN-QUESTIONS 3.24). `guardRef` holds the open views of the tab, so the page can ask before
 * it changes the tab.
 */
export const BuilderTabContent = ({
    tab,
    builderSaveToolCallId,
    onSectionOpened,
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    tab: BuilderTab
    /** The builder's latest save of this tab's agent in this visit (the pane follows it). */
    builderSaveToolCallId: string | null
    /** The person opened a section of this agent tab marked "Changed by the builder". */
    onSectionOpened: (section: MarkableSectionKey) => void
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    if (tab.kind === "agent")
        return (
            <AgentTab
                agentId={tab.id}
                builderSaveToolCallId={builderSaveToolCallId}
                changedSections={tab.changedSections}
                onSectionOpened={onSectionOpened}
                guardRef={guardRef}
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
                <PageViewStackGuard guardRef={guardRef} />
                <AutomationTabRoot
                    automationId={tab.id}
                    workspaceId={workspaceId}
                    projectId={projectId}
                />
            </ViewStackHost>
        )
    return <Notice>{t("builder.page.itemNotShown")}</Notice>
}
