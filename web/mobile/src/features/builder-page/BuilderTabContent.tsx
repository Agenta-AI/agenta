import type {MutableRefObject} from "react"

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
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    tab: BuilderTab
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
