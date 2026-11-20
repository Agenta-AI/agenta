import type {MutableRefObject} from "react"

import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"

import type {PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"

import {AgentTabContent} from "./AgentTabContent"
import {AutomationTabContent} from "./AutomationTabContent"
import type {BuilderTab} from "./builderTabs"
import {PaneNotice} from "./PaneNotice"

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
    /** The builders latest save of this tabs agent in this visit (the pane follows it). */
    builderSaveToolCallId: string | null
    /** The person opened or used a section of this agent tab marked "Changed by the builder". */
    onSectionOpened: (section: MarkableSectionKey) => void
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    if (tab.kind === "agent")
        return (
            <AgentTabContent
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
            <AutomationTabContent
                automationId={tab.id}
                name={tab.name}
                guardRef={guardRef}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    return <PaneNotice>{t("builder.page.itemNotShown")}</PaneNotice>
}
