import {useEffect, useRef, type ReactNode} from "react"

import {PhoneSectionsContext, usePhoneSectionScreen} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {PhoneScreenHeader, useIsPhone} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {SkeletonBlock, Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {DrawerViewChrome, useSystemBack, ViewStackHost} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AccessTab} from "../agent-layout/AccessTab"
import {AutomationsTab} from "../agent-layout/AutomationsTab"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {SessionWorkspaceDrawers} from "../chat/SessionWorkspaceDrawers"
import {startBlankSession} from "../chat/useStartBlankSession"
import {useTriggerTestRun} from "../chat/useTriggerTestRun"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermissionState} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

import {AgentPagesHeader} from "./AgentPagesHeader"
import {ConfigurationAgentTab} from "./ConfigurationAgentTab"
import {ConfigurationEditorProvider} from "./ConfigurationEditorProvider"
import {
    CONFIGURATION_PAGE_COLUMN,
    CONFIGURATION_TABS,
    isConfigurationTab,
    type ConfigurationTab,
} from "./configurationTabs"
import {PageViewStackGuard, type PageViewStackGuardApi} from "./PageViewStackGuard"
import {useConfigurationRevision} from "./useConfigurationRevision"

/**
 * The Configuration page of one agent (`?view=configuration&tab=<tab>`): the tabs Agent,
 * Automations and Access, over the same views the right panel shows. Only the Agent tab shows the
 * version and the save status. Changes on the Agent tab are saved by auto-save; Automations and
 * Access apply at once.
 */
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
    const t = useT(agentSidebarCatalog, agentLayoutPanelCatalog, agentLayoutHeaderCatalog)
    const tControls = useT(schemaControlsCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    const {revisionId, pin, failed, retry} = useConfigurationRevision(agentId)
    // The API refuses a Viewer's edits; editing stays open while the check is in flight.
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const readOnly = !editAccess.pending && !editAccess.allowed
    // "Create with AI" asks a chat composer to start the sentence; this page has none, so it opens
    // a new session of the agent, whose composer takes the request.
    const prefill = useAtomValue(composerPrefillRequestAtom)
    useEffect(() => {
        if (prefill) startBlankSession(`/w/${workspaceId}/p/${projectId}`, agentId)
    }, [agentId, prefill, projectId, workspaceId])
    // An automation's "Test run" starts a new session of this agent, as from the panel.
    useTriggerTestRun({entityId: revisionId, agentId, base: `/w/${workspaceId}/p/${projectId}`})
    // The Automations tab's open views (an automation form may hold edits).
    const automationsGuard = useRef<PageViewStackGuardApi | null>(null)
    // On a phone (M07) the Agent tab is a list of rows, and a row opens its section as a screen.
    const phone = useIsPhone()
    const sectionScreen = usePhoneSectionScreen(phone)
    // A section's screen is a level of the browser back, as its back arrow.
    useSystemBack(sectionScreen.shown ? 1 : 0, "section", sectionScreen.close)
    const shownSection = sectionScreen.shown
    const openTab = async (next: ConfigurationTab) => {
        const guard = automationsGuard.current
        // Leaving the tab closes its views; an open form with edits asks first.
        if (next !== tab && guard) {
            if (!(await guard.stack.closeAll())) return
            guard.allowNext()
        }
        sectionScreen.close()
        void router.replace({query: {...router.query, tab: next}}, undefined, {shallow: true})
    }

    // A version saved elsewhere is offered ("Update to vN"), not adopted on its own: a drawer form
    // here may hold edits. On a phone it sits at the end of the tab row (M07).
    const revisionStatus =
        tab === "agent" && revisionId ? (
            <AgentRevisionStatus
                revisionId={revisionId}
                historyWorkflowId={agentId}
                onUpdate={pin}
                phone={phone}
                backTitle={t("agentLayout.header.configuration")}
                className={phone ? "shrink-0" : undefined}
            />
        ) : null

    const loading = (
        <div className="flex flex-col gap-3" aria-busy>
            <SkeletonBlock active className="h-12 w-full" />
            <SkeletonBlock active className="h-24 w-full" />
            <SkeletonBlock active className="h-24 w-full" />
        </div>
    )
    // On a desktop every tab but a loaded Agent tab sits in a 760 px centered column; the Agent
    // tab draws its own, wider column.
    // `inset` is false for a body that pads its own rows (the automations list).
    const column = (node: ReactNode, inset = true) =>
        phone ? (
            node
        ) : (
            <div
                className={cn(
                    "mx-auto box-border flex min-h-0 w-full max-w-[760px] flex-1 flex-col pt-3.5",
                    inset && "px-4",
                )}
            >
                {node}
            </div>
        )
    // Access needs no revision; the other tabs wait for one.
    const body =
        tab === "access" ? (
            phone ? (
                <div className="max-w-[560px]">
                    <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
                </div>
            ) : (
                column(
                    <AccessTab
                        agentId={agentId}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        className="p-0"
                    />,
                )
            )
        ) : failed ? (
            column(
                <LoadError
                    framed
                    title={tControls("entityUi.schemaControls.configCouldNotLoad")}
                    onRetry={retry}
                />,
            )
        ) : !revisionId ? (
            column(loading)
        ) : tab === "agent" ? (
            <PhoneSectionsContext.Provider value={sectionScreen.api}>
                <ConfigurationAgentTab revisionId={revisionId} readOnly={readOnly} />
            </PhoneSectionsContext.Provider>
        ) : (
            // The panel's Automations tab, without its Files part (this page has no session), with no
            // card around it. Its automation views open in the page, under the crumb "Automations";
            // the drawer chrome shows no close button outside a drawer.
            column(
                <div className="min-h-0 flex-1 overflow-hidden bg-background">
                    <ViewStackHost
                        chrome={DrawerViewChrome}
                        rootTitle={t("agentLayout.panel.automations")}
                        phone={phone}
                    >
                        <PageViewStackGuard guardRef={automationsGuard} />
                        <AutomationsTab
                            revisionId={revisionId}
                            workspaceId={workspaceId}
                            projectId={projectId}
                        />
                    </ViewStackHost>
                </div>,
                false,
            )
        )

    return (
        <>
            <PageTitle title={t("agentSidebar.configuration")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                {/* One Tabs root for the tab row and the open tab's panel. */}
                <Tabs
                    className="contents"
                    value={tab}
                    onValueChange={(next) => {
                        if (isConfigurationTab(next)) void openTab(next)
                    }}
                >
                    <ScreenScaffold
                        // On a desktop each tab scrolls its own column.
                        fill={!phone}
                        header={
                            shownSection ? (
                                <PhoneScreenHeader
                                    title={shownSection.title}
                                    backTitle={t("agentLayout.header.configuration")}
                                    onBack={sectionScreen.close}
                                />
                            ) : phone ? (
                                <div className="box-border shrink-0 px-4 pb-3 pt-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <NavDrawer
                                            workspaceId={workspaceId}
                                            projectId={projectId}
                                        />
                                        <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                            {t("agentSidebar.configuration")}
                                        </h1>
                                    </div>
                                    <div className="mt-3 flex min-w-0 items-center gap-1">
                                        <TabsList className="ag-scroll-no-bar min-w-0 flex-1 justify-start overflow-x-auto">
                                            {CONFIGURATION_TABS.map((key) => (
                                                <TabsTrigger
                                                    key={key}
                                                    value={key}
                                                    className="min-h-11 shrink-0"
                                                >
                                                    {t(`agentLayout.panel.${key}`)}
                                                </TabsTrigger>
                                            ))}
                                        </TabsList>
                                        {revisionStatus}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <AgentPagesHeader
                                        title={t("agentSidebar.configuration")}
                                        workspaceId={workspaceId}
                                        projectId={projectId}
                                        actions={revisionStatus}
                                    />
                                    {/* The tab row sits in the page column, on its own strip. */}
                                    <div className="box-border h-10 shrink-0 border-0 border-b border-solid border-colorBorderSecondary bg-background">
                                        <div className={`flex h-full ${CONFIGURATION_PAGE_COLUMN}`}>
                                            <TabsList className="h-full gap-[18px] p-0">
                                                {CONFIGURATION_TABS.map((key) => (
                                                    <TabsTrigger
                                                        key={key}
                                                        value={key}
                                                        className="h-full flex-none rounded-none px-0.5 py-0 text-[13px] font-normal text-muted-foreground after:-bottom-px data-[state=active]:font-medium"
                                                    >
                                                        {t(`agentLayout.panel.${key}`)}
                                                    </TabsTrigger>
                                                ))}
                                            </TabsList>
                                        </div>
                                    </div>
                                </>
                            )
                        }
                    >
                        <TabsContent
                            value={tab}
                            className={cn(
                                "flex h-full min-h-0 min-w-0 flex-col",
                                phone &&
                                    // On a phone the Agent and Automations tabs run edge to edge.
                                    (tab === "agent" || tab === "automations"
                                        ? `p-0 ${SESSIONS_PAGE_FRAME}`
                                        : `px-4 pb-6 pt-3 ${SESSIONS_PAGE_FRAME}`),
                            )}
                        >
                            {/* The same host parts (model providers, skills, subagents) and edit
                            right as the right panel; a commit made here pins the new revision. */}
                            <DrillInBridgeProvider
                                projectId={projectId}
                                onWorkflowRevisionCommitted={pin}
                            >
                                <ConfigurationEditorProvider
                                    agentId={agentId}
                                    revisionId={revisionId}
                                    readOnly={readOnly}
                                    tab={tab}
                                >
                                    {body}
                                </ConfigurationEditorProvider>
                            </DrillInBridgeProvider>
                        </TabsContent>
                    </ScreenScaffold>
                </Tabs>
            </AppShell>
            {/* The automation, catalog and run history drawers the tabs open. */}
            <SessionWorkspaceDrawers workspaceId={workspaceId} projectId={projectId} />
        </>
    )
}
