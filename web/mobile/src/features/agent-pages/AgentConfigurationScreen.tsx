import {useEffect, useRef, useState} from "react"

import {AgentOperationsSkeleton, usePhoneSectionScreen} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPageCatalog from "@agenta/i18n/catalogs/agentPages.page"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {PhoneScreenHeader, useIsPhone} from "@agenta/ui/phone"
import {PageToolbar, Segmented} from "@agenta/ui/ui"
import {ReportOpenViewItemContext, type OpenViewItem} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {AccessTab} from "../agent-layout/AccessTab"
import {AgentConfigHost} from "../agent-layout/AgentConfigHost"
import {AutomationsTab} from "../agent-layout/AutomationsTab"
import {usePublishPageContext} from "../builder/pageContext"
import {ConfigPane} from "../chat/ConfigPane"
import {SessionWorkspaceDrawers} from "../chat/SessionWorkspaceDrawers"
import {startBlankSession} from "../chat/useStartBlankSession"
import {useTriggerTestRun} from "../chat/useTriggerTestRun"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {PageLayout} from "../page-layout/PageLayout"

import {AgentBuilderButton} from "./AgentBuilderButton"
import {CONFIGURATION_TABS, isConfigurationTab, type ConfigurationTab} from "./configurationTabs"
import type {PageViewStackGuardApi} from "./PageViewStackGuard"
import {ReportViewsOpen} from "./ReportViewsOpen"
import {AgentConfigSectionsSkeleton} from "./states/AgentConfigSectionsSkeleton"
import {useConfigurationRevision} from "./useConfigurationRevision"

/** The agent's Configuration page: the session pane's sections and views, in the page layout. */
export const AgentConfigurationScreen = ({
    workspaceId,
    projectId,
    agentId,
    tab,
}: {
    workspaceId: string
    projectId: string
    agentId: string
    tab: ConfigurationTab
}) => {
    const t = useT(agentSidebarCatalog, agentLayoutPanelCatalog, agentPagesPageCatalog)
    const tControls = useT(schemaControlsCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    const phone = useIsPhone()
    const {revisionId, pin, failed, retry} = useConfigurationRevision(agentId)
    // "Create with AI" needs a composer: open a new session of the agent.
    const prefill = useAtomValue(composerPrefillRequestAtom)
    useEffect(() => {
        if (prefill) startBlankSession(`/w/${workspaceId}/p/${projectId}`, agentId)
    }, [agentId, prefill, projectId, workspaceId])
    // An automation's "Test run" starts a new session of this agent, as from the panel.
    useTriggerTestRun({entityId: revisionId, agentId, base: `/w/${workspaceId}/p/${projectId}`})
    // The builder reads the open tab and the item an open view shows.
    const [item, setItem] = useState<OpenViewItem | null>(null)
    usePublishPageContext({kind: "configuration", tab, ...(item ? {item} : {})})
    // The open views: a form with edits asks before a navigation.
    const guard = useRef<PageViewStackGuardApi | null>(null)
    // On a phone a section row opens the section as its own page (M07).
    const sectionScreen = usePhoneSectionScreen(phone)
    const shownSection = sectionScreen.shown

    // The switch shows only with no view open, so a tab switch drops no form.
    const openTab = (next: ConfigurationTab) => {
        sectionScreen.close()
        void router.replace({query: {...router.query, tab: next}}, undefined, {shallow: true})
    }

    const body =
        tab === "access" ? (
            <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
        ) : failed ? (
            <div className="p-4">
                <LoadError
                    framed
                    title={tControls("entityUi.schemaControls.configCouldNotLoad")}
                    onRetry={retry}
                />
            </div>
        ) : !revisionId ? (
            tab === "agent" ? (
                <AgentConfigSectionsSkeleton />
            ) : (
                <AgentOperationsSkeleton sticky={false} />
            )
        ) : tab === "agent" ? (
            <ConfigPane entityId={revisionId} page />
        ) : (
            <AutomationsTab
                revisionId={revisionId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )

    const configuration = t("agentSidebar.configuration")
    // An open view hides the page head; on a phone it covers the page as its own screen (M07).
    const [viewsOpen, setViewsOpen] = useState(false)
    const phoneSection = phone && shownSection && revisionId ? shownSection : null
    const screen =
        phone && (viewsOpen || phoneSection)
            ? {
                  header: viewsOpen ? null : (
                      <PhoneScreenHeader
                          title={phoneSection?.title ?? configuration}
                          backTitle={configuration}
                          onBack={sectionScreen.close}
                      />
                  ),
              }
            : undefined
    // One tree on every width, so a resize or a section keeps the open views and their edits.
    return (
        <>
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                width="md"
                title={configuration}
                description={t("agentPages.page.configurationDescription")}
                actions={
                    <>
                        {/* Quiet: Update to vN for a newer version, or a failed save's retry. */}
                        {revisionId && tab !== "access" ? (
                            <AgentRevisionStatus
                                quiet
                                revisionId={revisionId}
                                historyWorkflowId={agentId}
                                // An open view edits the held version: no update, manual or auto, under it.
                                onUpdate={viewsOpen ? undefined : pin}
                                autoUpdate={!viewsOpen}
                                phone={phone}
                            />
                        ) : null}
                        <AgentBuilderButton />
                    </>
                }
                screen={screen}
                // Inside an item its own crumb and footer are the header (no page head over it).
                headClassName={viewsOpen ? "hidden" : undefined}
                toolbar={
                    viewsOpen ? undefined : (
                        <PageToolbar
                            actions={
                                <Segmented
                                    aria-label={configuration}
                                    value={tab}
                                    onChange={(next) => {
                                        if (isConfigurationTab(next)) openTab(next)
                                    }}
                                    options={CONFIGURATION_TABS.map((key) => ({
                                        value: key,
                                        label: t(`agentLayout.panel.${key}`),
                                    }))}
                                />
                            }
                        />
                    )
                }
            >
                {/* The pane's 16 px inset sits on the page column's line. */}
                <div
                    className={screen ? "flex min-h-0 flex-1 flex-col" : "-mx-4"}
                    aria-busy={tab !== "access" && !revisionId && !failed}
                >
                    <ReportOpenViewItemContext.Provider value={setItem}>
                        <AgentConfigHost
                            agentId={agentId}
                            revisionId={revisionId}
                            projectId={projectId}
                            readChannels={tab === "agent"}
                            rootTitle={t(`agentLayout.panel.${tab}`)}
                            phone={phone}
                            sectionScreen={sectionScreen}
                            onWorkflowRevisionCommitted={pin}
                            guardRef={guard}
                            page
                        >
                            {() => (
                                <>
                                    <ReportViewsOpen onChange={setViewsOpen} />
                                    {phoneSection && revisionId ? (
                                        <ConfigPane entityId={revisionId} />
                                    ) : (
                                        body
                                    )}
                                </>
                            )}
                        </AgentConfigHost>
                    </ReportOpenViewItemContext.Provider>
                </div>
            </PageLayout>
            {/* The automation and catalog drawers the tabs open. */}
            <SessionWorkspaceDrawers />
        </>
    )
}
