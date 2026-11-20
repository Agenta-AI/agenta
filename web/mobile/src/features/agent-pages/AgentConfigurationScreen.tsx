import {useEffect, useMemo} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AccessTab} from "../agent-layout/AccessTab"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {SessionWorkspaceDrawers} from "../chat/SessionWorkspaceDrawers"
import {startBlankSession} from "../chat/useStartBlankSession"
import {useTriggerTestRun} from "../chat/useTriggerTestRun"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermissionState} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

import {ConfigurationAgentTab} from "./ConfigurationAgentTab"
import {ConfigurationAutomationsTab} from "./ConfigurationAutomationsTab"
import {CONFIGURATION_TABS, type ConfigurationTab} from "./configurationTabs"
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
    const t = useT(agentSidebarCatalog, agentLayoutPanelCatalog)
    const tControls = useT(schemaControlsCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    const {revisionId, pin, failed, retry} = useConfigurationRevision(agentId)
    // The API refuses a Viewer's edits; editing stays open while the check is in flight.
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const readOnly = !editAccess.pending && !editAccess.allowed
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly} : null),
        [readOnly, revisionId],
    )
    // "Create with AI" asks a chat composer to start the sentence; this page has none, so it opens
    // a new session of the agent, whose composer takes the request.
    const prefill = useAtomValue(composerPrefillRequestAtom)
    useEffect(() => {
        if (prefill) startBlankSession(`/w/${workspaceId}/p/${projectId}`, agentId)
    }, [agentId, prefill, projectId, workspaceId])
    // An automation's "Test run" starts a new session of this agent, as from the panel.
    useTriggerTestRun({entityId: revisionId, agentId, base: `/w/${workspaceId}/p/${projectId}`})
    const openTab = (next: ConfigurationTab) =>
        void router.replace({query: {...router.query, tab: next}}, undefined, {shallow: true})

    const loading = (
        <div className="flex flex-col gap-3" aria-busy>
            <SkeletonBlock active className="h-12 w-full" />
            <SkeletonBlock active className="h-24 w-full" />
            <SkeletonBlock active className="h-24 w-full" />
        </div>
    )
    // Access needs no revision; the other tabs wait for one.
    const body =
        tab === "access" ? (
            <div className="max-w-[560px]">
                <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
            </div>
        ) : failed ? (
            <LoadError
                framed
                title={tControls("entityUi.schemaControls.configCouldNotLoad")}
                onRetry={retry}
            />
        ) : !revisionId ? (
            loading
        ) : tab === "agent" ? (
            <ConfigurationAgentTab revisionId={revisionId} readOnly={readOnly} />
        ) : (
            <ConfigurationAutomationsTab revisionId={revisionId} readOnly={readOnly} />
        )

    return (
        <>
            <PageTitle title={t("agentSidebar.configuration")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${SESSIONS_PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    {t("agentSidebar.configuration")}
                                </h1>
                                {tab === "agent" && revisionId ? (
                                    <AgentRevisionStatus
                                        revisionId={revisionId}
                                        historyWorkflowId={agentId}
                                        // A version saved elsewhere is offered ("Update to vN"),
                                        // not adopted on its own: a drawer form here may hold edits.
                                        onUpdate={pin}
                                    />
                                ) : null}
                            </div>
                            <div
                                role="tablist"
                                className="mt-3 flex items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary"
                            >
                                {CONFIGURATION_TABS.map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        role="tab"
                                        aria-selected={tab === key}
                                        className={cn(
                                            "-mb-px h-9 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 text-sm [font-family:inherit]",
                                            tab === key
                                                ? "border-colorText font-medium text-colorText"
                                                : "border-transparent text-colorTextSecondary hover:text-colorText",
                                        )}
                                        onClick={() => openTab(key)}
                                    >
                                        {t(`agentLayout.panel.${key}`)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    }
                >
                    <div
                        role="tabpanel"
                        className={`flex h-full min-h-0 min-w-0 flex-col px-4 pb-6 pt-3 ${SESSIONS_PAGE_FRAME}`}
                    >
                        {/* The same host parts (model providers, skills, subagents) and edit
                            right as the right panel; a commit made here pins the new revision. */}
                        <DrillInBridgeProvider
                            projectId={projectId}
                            onWorkflowRevisionCommitted={pin}
                        >
                            <AgentEditorContext.Provider value={editor}>
                                {body}
                            </AgentEditorContext.Provider>
                        </DrillInBridgeProvider>
                    </div>
                </ScreenScaffold>
            </AppShell>
            {/* The automation, catalog and run history drawers the tabs open. */}
            <SessionWorkspaceDrawers workspaceId={workspaceId} projectId={projectId} />
        </>
    )
}
