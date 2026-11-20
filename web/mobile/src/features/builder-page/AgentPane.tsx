import {useEffect, useMemo, useRef, useState, type MutableRefObject} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import {
    DriveSessionProvider,
    SessionFilesPane,
    sessionFilesPaneOpenAtomFamily,
} from "@agenta/entity-ui/drive"
import {formatNumber, useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {DrawerViewChrome, useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import {useSetAtom} from "jotai"

import {cn} from "@/lib/utils"

import {AccessTab} from "../agent-layout/AccessTab"
import {AutomationsTab} from "../agent-layout/AutomationsTab"
import {ChannelsTab} from "../agent-layout/ChannelsTab"
import {PageViewStackGuard, type PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"
import {useConfigurationRevision} from "../agent-pages/useConfigurationRevision"
import {ConfigPane} from "../chat/ConfigPane"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useTriggerTestRun} from "../chat/useTriggerTestRun"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useProjectPermissionState} from "../context/useProjectPermission"

import {followAction} from "./followBuilder"
import {PaneSessions, usePaneSessions} from "./PaneSessions"

/** The pane tabs of an agent tab (B03): the Configuration tabs, then Drives and Sessions. */
export const PANE_TABS = [
    "agent",
    "automations",
    "channels",
    "access",
    "drives",
    "sessions",
] as const
export type PaneTab = (typeof PANE_TABS)[number]

/**
 * One agent tab of the builder page's pane: a row of pane tabs over the same views as the right
 * panel and the agent pages, with the same data. It opens on Agent. Only the open pane tab is
 * mounted.
 */
export const AgentPane = ({
    agentId,
    builderChangeId = null,
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    agentId: string
    /** The tool call of the builder's latest save of this agent in this visit; the pane follows it. */
    builderChangeId?: string | null
    /** The open pane tab's views, shared with the page so it can ask before a builder tab change. */
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    /** The builder chat: the session the Drives pane reads its session files from. */
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog, agentLayoutPanelCatalog)
    const tControls = useT(schemaControlsCatalog)
    const [tab, setTab] = useState<PaneTab>("agent")
    const {revisionId, pin, failed, retry} = useConfigurationRevision(agentId)
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const readOnly = !editAccess.pending && !editAccess.allowed
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly} : null),
        [readOnly, revisionId],
    )
    const sessions = usePaneSessions(projectId, agentId)
    const sessionCount = sessions.data?.total ?? sessions.data?.sessions?.length ?? 0
    // An automation's "Run now" starts a new session of this agent, as from the panel.
    useTriggerTestRun({entityId: revisionId, agentId, base: `/w/${workspaceId}/p/${projectId}`})
    // The Agent pane tab's dot: the builder saved a change the pane did not move to show.
    const [agentDot, setAgentDot] = useState(false)
    // The open pane tab's views: an open form with edits asks before a switch.
    const openTab = async (next: PaneTab) => {
        if (next === tab) return
        if (guardRef.current && !(await guardRef.current.stack.closeAll())) return
        setTab(next)
        if (next === "agent") setAgentDot(false)
    }

    // Follow the builder (the 10 second rule): a save of this agent shows the Agent pane tab,
    // unless the person clicked in the pane in the last 10 seconds or a form has edits; then the
    // Agent pane tab gets a dot.
    const lastPointerDown = useRef<number | null>(null)
    const followed = useRef(builderChangeId)
    useEffect(() => {
        if (!builderChangeId || builderChangeId === followed.current) return
        followed.current = builderChangeId
        const action = followAction<PaneTab>({
            paneTab: tab,
            target: "agent",
            now: Date.now(),
            lastPointerDown: lastPointerDown.current,
            dirty: guardRef.current?.stack.dirty ?? false,
        })
        if (action === "show") setTab("agent")
        else if (action === "dot") setAgentDot(true)
        // Only a new save is followed; the pane tab on screen is read at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [builderChangeId])

    const needsRevision = tab === "agent" || tab === "automations"
    let body
    if (needsRevision && failed)
        body = (
            <div className="p-4">
                <LoadError
                    framed
                    title={tControls("entityUi.schemaControls.configCouldNotLoad")}
                    onRetry={retry}
                />
            </div>
        )
    else if (needsRevision && !revisionId)
        body = (
            <div className="flex flex-col gap-3 p-4" aria-busy>
                <SkeletonBlock active className="h-12 w-full" />
                <SkeletonBlock active className="h-24 w-full" />
            </div>
        )
    else if (tab === "agent" && revisionId) body = <ConfigPane entityId={revisionId} />
    else if (tab === "automations" && revisionId)
        body = (
            <AutomationsTab
                revisionId={revisionId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    else if (tab === "channels")
        body = <ChannelsTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
    else if (tab === "access")
        body = <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
    else if (tab === "drives")
        body = (
            <PaneDrives
                agentId={agentId}
                revisionId={revisionId}
                builderSessionId={builderSessionId}
            />
        )
    else body = <PaneSessions agentId={agentId} projectId={projectId} workspaceId={workspaceId} />

    const label = (key: PaneTab) =>
        key === "drives"
            ? t("builder.page.drives")
            : key === "sessions"
              ? t("builder.page.sessions")
              : t(`agentLayout.panel.${key}`)

    return (
        <div
            className="flex h-full min-h-0 flex-col"
            data-testid="builder-agent-pane"
            onPointerDownCapture={() => {
                lastPointerDown.current = Date.now()
            }}
        >
            <div
                role="tablist"
                className="flex h-12 shrink-0 items-center gap-4 border-0 border-b border-solid border-colorBorderSecondary px-4"
            >
                {PANE_TABS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => void openTab(key)}
                        className={cn(
                            "flex h-12 cursor-pointer items-center gap-1 border-0 border-b-2 border-solid bg-transparent px-0 text-[13px]",
                            tab === key
                                ? "border-colorText font-medium text-colorText"
                                : "border-transparent text-colorTextSecondary hover:text-colorText",
                        )}
                    >
                        {label(key)}
                        {key === "agent" && agentDot ? (
                            <span
                                data-testid="pane-tab-dot"
                                aria-label={t("builder.page.changedByBuilder")}
                                className="size-1.5 shrink-0 rounded-full bg-colorPrimary"
                            />
                        ) : null}
                        {key === "sessions" && sessionCount > 0 ? (
                            <span className="text-xs text-colorTextTertiary">
                                {formatNumber(sessionCount)}
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>
            <div role="tabpanel" className="min-h-0 flex-1">
                <DrillInBridgeProvider projectId={projectId} onWorkflowRevisionCommitted={pin}>
                    <AgentEditorContext.Provider value={editor}>
                        <ViewStackHost key={tab} chrome={DrawerViewChrome} rootTitle={label(tab)}>
                            <PageViewStackGuard guardRef={guardRef} />
                            <PublishFormDirty />
                            {body}
                        </ViewStackHost>
                    </AgentEditorContext.Provider>
                </DrillInBridgeProvider>
            </div>
        </div>
    )
}

/** Tells the builder chat that a pane form has edits (`has_unsaved_draft` in its context line). */
const PublishFormDirty = () => {
    const stack = useViewStack()
    const setViewFormDirty = useSetAtom(viewFormDirtyAtom)
    useEffect(() => {
        setViewFormDirty(stack.dirty)
    }, [stack.dirty, setViewFormDirty])
    useEffect(() => () => setViewFormDirty(false), [setViewFormDirty])
    return null
}

/**
 * The Drives pane tab: the agent's drives in the Files pane. Its open state is the page's own
 * (`builder-page:<agent>`), so opening it here does not open the Files pane on the agent's pages.
 */
const PaneDrives = ({
    agentId,
    revisionId,
    builderSessionId,
}: {
    agentId: string
    revisionId: string | null
    builderSessionId: string
}) => {
    const scope = `builder-page:${agentId}`
    const setOpen = useSetAtom(sessionFilesPaneOpenAtomFamily(scope))
    useEffect(() => setOpen(true), [setOpen])
    return (
        <DriveSessionProvider
            sessionId={builderSessionId}
            artifactId={agentId}
            revisionId={revisionId}
        >
            <SessionFilesPane scope={scope} sessionId={builderSessionId} closeControl="none" />
        </DriveSessionProvider>
    )
}
