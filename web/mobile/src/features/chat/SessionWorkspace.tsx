import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    configPanelCollapsedOverrideAtom,
    configPanelCollapsedViewportPreferenceAtom,
    FILES_PANE_MAX,
    FILES_PANE_MIN,
    filesPaneWidthAtom,
    phoneViewportAtom,
    resolveConfigPanelCollapsed,
    revealConfigPaneAtom,
    RIGHT_PANEL_MAX,
    RIGHT_PANEL_MIN,
    rightPanelWidthAtom,
    useCanPanesCoexist,
    useFilesPaneLayout,
} from "@agenta/chat/state"
import {browserPaneOpenAtomFamily} from "@agenta/entities/browser"
import {useDriveDirtyGuard} from "@agenta/entities/drive"
import type {SessionStream} from "@agenta/entities/session"
import {sharingKeys, type SessionSharingResponse} from "@agenta/entities/sharing"
import {BrowserPane} from "@agenta/entity-ui/browser"
import {
    DriveLinkContext,
    DriveSessionProvider,
    SessionFilesPane,
    useSessionFilesPane,
} from "@agenta/entity-ui/drive"
import {SIDEBAR_DEFAULT_WIDTH} from "@agenta/navigation"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {sessionRoutePath} from "@agenta/sessions/link"
import {renderedSessionTabsAtomFamily, sessionTabScope} from "@agenta/sessions/state"
import {useSessionActions} from "@agenta/sessions-ui"
import {getHostQueryClient, isBrowserEnabled} from "@agenta/shared/api"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {useSessionShortcuts} from "@agenta/ui/shortcuts"
import {SplitPane, usePaneSlide} from "@agenta/ui/ui"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useAutomationUrlSync} from "../automations/useAutomationUrlSync"
import {AppShell} from "../nav/AppShell"

import {CollapsedConfigRail} from "./CollapsedConfigRail"
import {PaneEdgeToggle} from "./PaneEdgeToggle"
import {selectedRevisionAtomFamily} from "./selectedRevision"
import {sessionBarPanelAtom, sessionRenameRequestAtom} from "./sessionBarState"
import {resolveSessionPanes} from "./sessionPanes"
import {SessionsPane} from "./SessionsPane"
import {SessionTopBar} from "./SessionTopBar"
import {ConfigPaneLoading} from "./states/ConfigPaneLoading"
import {useDriveUrlSync} from "./useDriveUrlSync"
import {useLeaveSession} from "./useLeaveSession"
import {sessionHeaderKey} from "./useSessionHeader"
import {useStartBlankSession} from "./useStartBlankSession"
import {useTriggerTestRun} from "./useTriggerTestRun"

// Build's config panel carries the whole schema-form surface (DrillInView + the editor). Chat
// mode never renders it, so it loads on demand instead of riding in the session page's bundle.
// Until the chunk lands the pane shows its skeleton, not an empty column.
const ConfigPane = dynamic(() => import("./ConfigPane").then((m) => m.ConfigPane), {
    ssr: false,
    loading: ConfigPaneLoading,
})

// The tool catalog is opened by setting an atom, so whoever opens it needs this mounted or the
// action does nothing. It sits at the workspace rather than inside the config pane, because the
// agent's own connect widget opens it from the transcript and in chat mode the config pane does
// not render. One mount, always present, as the desktop playground keeps one beside its panels.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)

// Mounted here, not in the config pane, so a linked drawer opens while that pane is collapsed.
const AutomationDrawer = dynamic(
    () => import("@agenta/automation-ui").then((m) => m.AutomationDrawer),
    {ssr: false},
)
const AutomationRunHistoryDrawerHost = dynamic(
    () =>
        import("../automations/AutomationRunHistoryDrawerHost").then(
            (m) => m.AutomationRunHistoryDrawerHost,
        ),
    {ssr: false},
)

/**
 * The playground's two-pane frame, on the SAME kit `SplitPane` the desktop drives it with and the
 * SAME `chatPanelMaximizedAtom` that decides the mode: "chat" maximizes the conversation (config
 * collapsed to 0, session rail in its place), "build" is the two-panel edit view.
 *
 * The conversation is ALWAYS mounted EXACTLY ONCE — the mode only decides what sits beside it, and
 * the width only decides the geometry — so neither a mode switch nor a rotation drops a streaming
 * turn. That is why both widths drive the SAME `SplitPane` rather than two sibling containers: a
 * node rendered in two containers mounts twice even when one is CSS-hidden, which ran two chat
 * engines at once.
 *
 * Pane geometry is the desktop's, shared from `@agenta/chat/state`. Below `md` there is no room
 * for two panes, so the split collapses to one visible pane and the mode picks which.
 */
export const SessionWorkspace = ({
    entityId,
    agentId,
    agentResolving = false,
    linkEntityId = entityId,
    linkAgentId = agentId,
    agentHidden = false,
    canSend = true,
    sessionId,
    workspaceId,
    projectId,
    chat,
    bare = false,
    hideSessionSwitcher = false,
    collapseConfigByDefault = false,
    deepLinks = false,
}: {
    /** The revision being configured. Absent = nothing to build yet (a session with no turns). */
    entityId: string | null
    agentId?: string | null
    /** The session's agent is still being read; a null `agentId` is not yet the answer. */
    agentResolving?: boolean
    /**
     * This session's own revision and agent, without the last session's held across a switch.
     * A linked automation drawer opens with them. Default: `entityId` and `agentId`.
     */
    linkEntityId?: string | null
    linkAgentId?: string | null
    /** The session's agent is one the reader cannot see (a private agent). */
    agentHidden?: boolean
    /** False when the reader may not send here: the top bar drops what only a sender uses. */
    canSend?: boolean
    sessionId: string
    workspaceId: string
    projectId: string
    /** The conversation, rendered embedded (it brings its own header, dock and composer). */
    chat: ReactNode
    /**
     * Skip the surrounding `AppShell`. A host that already renders one (first run, which swaps
     * only Home's body) would otherwise stack a second nav rail beside the first.
     */
    bare?: boolean
    /**
     * Hide the session switcher. Before the agent is created there is exactly one draft session
     * and no history, so there is nothing to switch between.
     */
    hideSessionSwitcher?: boolean
    /**
     * Start with the config pane collapsed, the way a phone already does. First run leads with the
     * question and the composer; the configuration is one `»` away rather than half the screen
     * before there is anything to configure.
     *
     * Only the DEFAULT — a stored preference still wins in both directions.
     */
    collapseConfigByDefault?: boolean
    /** Mirror the Files pane and the automation drawer in the URL; only where the URL names this session. */
    deepLinks?: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    useAutomationUrlSync({
        enabled: deepLinks,
        ready: !agentResolving && (Boolean(linkEntityId) || !linkAgentId),
        playgroundEntityId: linkEntityId ?? undefined,
        scope: sessionId,
    })
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    // Collapsing the config panel is separate from the Build/Chat mode: the desktop keeps you in
    // Build with the panel out of the way, and the top bar's "»" brings it back.
    // Follow the revision an auto-commit produced. Pin it rather than unpinning: unpinning falls
    // back to the latest-revision query, which is stale for a beat, so a commit made FROM an
    // older revision would land the pane on whatever that query last cached. The desktop gets
    // this switch from the workflow bridge's onNewRevision; mobile registers none.
    //
    // It lives HERE and not in `ConfigPane` because a commit can land while the config pane is
    // off screen — the pane is swapped out on a phone whenever the conversation has the width.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    useEffect(
        () =>
            registerAgentAutoCommitHandler(
                `session-workspace:${sessionId}`,
                (revisionId, newRevisionId) => {
                    if (revisionId === entityId) pinRevision(newRevisionId)
                },
            ),
        [entityId, pinRevision, sessionId],
    )

    // An automation row's "Test run" (config pane) lands in a new session with this agent.
    useTriggerTestRun({entityId, agentId, base})

    // Resolved from the parts rather than read off `configPanelCollapsedAtom`: that atom answers
    // for a device, and this surface gets to answer too. A stored preference still beats both.
    //
    // `collapseConfigByDefault` surfaces (the create-an-agent page) LAND collapsed no matter
    // what the session pages stored — the two surfaces must not share their landing state. The
    // mount-scoped override does it: any user write (the `»` reveal, the pane's own collapse)
    // clears it, so the controls work immediately and the preference resumes from that tap.
    const setConfigOverride = useSetAtom(configPanelCollapsedOverrideAtom)
    useEffect(() => {
        if (!collapseConfigByDefault) return
        setConfigOverride(true)
        return () => setConfigOverride(null)
    }, [collapseConfigByDefault, setConfigOverride])
    const configOverride = useAtomValue(configPanelCollapsedOverrideAtom)
    const configPreference = useAtomValue(configPanelCollapsedViewportPreferenceAtom)
    const phoneViewport = useAtomValue(phoneViewportAtom)
    const configCollapsed =
        configOverride ??
        resolveConfigPanelCollapsed(configPreference, phoneViewport, collapseConfigByDefault)
    // Files dock as a resizable right-edge pane, as they do on the desktop, rather than an
    // overlay drawer. Scope is the AGENT, not the session: opening files then switching session
    // must not snap the pane shut.
    const filesScope = agentId ?? sessionId
    const {
        open: filesOpen,
        close: closeFilesPane,
        toggle: toggleFilesPane,
    } = useSessionFilesPane(filesScope, sessionId)
    const driveLink = useDriveUrlSync({sessionId, open: filesOpen, enabled: deepLinks})
    // Drafts outlive the pane, so the unload guard lives on the host.
    useDriveDirtyGuard()
    // Tailwind's `md`. Client-only, so the first paint is the phone layout — the right guess here.
    const twoPane = useMediaQuery("(min-width: 768px)")
    const filesLayout = useFilesPaneLayout(
        `m:${workspaceId}:${projectId}:${filesScope}`,
        sessionId,
        filesOpen,
    )
    // The agent's browser docks in the same right-edge slot, one of the two at a time.
    const browserEnabled = isBrowserEnabled()
    const [browserPaneOpen, setBrowserOpen] = useAtom(browserPaneOpenAtomFamily(sessionId))
    const browserOpen = browserEnabled && browserPaneOpen
    const dockOpen = filesOpen || browserOpen
    const closeDock = useCallback(() => {
        closeFilesPane()
        setBrowserOpen(false)
    }, [closeFilesPane, setBrowserOpen])
    const prevBrowserOpenRef = useRef(browserOpen)
    useEffect(() => {
        if (browserOpen && !prevBrowserOpenRef.current) closeFilesPane()
        prevBrowserOpenRef.current = browserOpen
    }, [browserOpen, closeFilesPane])
    const prevFilesOpenForBrowserRef = useRef(filesOpen)
    useEffect(() => {
        if (filesOpen && !prevFilesOpenForBrowserRef.current) setBrowserOpen(false)
        prevFilesOpenForBrowserRef.current = filesOpen
    }, [filesOpen, setBrowserOpen])
    const filesExpanded = filesLayout.expanded && !browserOpen
    // Never a config pane for a hidden agent: its configuration is exactly what the reader may not
    // see, and a pane mounted while it was visible is dropped below, not kept hidden.
    const configEntityId = agentHidden ? null : entityId
    // Which half is on screen. The rule is in `sessionPanes.ts`, with its tests: on a phone the
    // pane replaces the conversation, so getting it wrong puts the composer out of reach.
    const {showConfig, showPane, showFiles} = resolveSessionPanes({
        chatMaximized,
        configCollapsed,
        twoPane,
        hasEntity: Boolean(configEntityId),
        filesOpen: dockOpen,
        filesExpanded,
    })
    // Live px during a drag, mirrored from the shared persisted width — which is written at
    // pointer-up, not per frame, so a drag does not hammer localStorage.
    const [storedPaneWidth, setStoredPaneWidth] = useAtom(rightPanelWidthAtom)
    const [paneSize, setPaneSize] = useState(storedPaneWidth)
    useEffect(() => setPaneSize(storedPaneWidth), [storedPaneWidth])
    // The files pane keeps its own persisted width — the two panes are dragged independently.
    const [storedFilesWidth, setStoredFilesWidth] = useAtom(filesPaneWidthAtom)
    const [filesPaneSize, setFilesPaneSize] = useState(storedFilesWidth)
    useEffect(() => setFilesPaneSize(storedFilesWidth), [storedFilesWidth])

    // Both panes slide rather than snap, on the same shared mechanism the desktop uses. Without
    // it the pane's width flipped in one frame and its content unmounted before the flip, so
    // opening and hiding either panel jumped instead of moving.
    const configSlide = usePaneSlide(showPane || filesExpanded)
    const filesSlide = usePaneSlide(showFiles)

    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)
    const revealConfig = useSetAtom(revealConfigPaneAtom)

    // "Create with AI" in the config pane writes a prompt into the composer. On a phone the pane
    // covers the conversation, so hand the screen back to the chat where the prompt landed.
    const composerPrefillRequest = useAtomValue(composerPrefillRequestAtom)
    useEffect(() => {
        if (composerPrefillRequest && !twoPane) setConfigCollapsed(true)
    }, [composerPrefillRequest, twoPane, setConfigCollapsed])

    // The desktop's coexistence rule: too narrow for both side panes, so they take turns.
    // Edge-triggered, so they cannot evict each other in a loop.
    const canPanesCoexist = useCanPanesCoexist(SIDEBAR_DEFAULT_WIDTH)
    const panesMustAlternate = twoPane && !canPanesCoexist
    const prevFilesOpenRef = useRef(dockOpen)
    useEffect(() => {
        if (dockOpen && !prevFilesOpenRef.current && panesMustAlternate) setConfigCollapsed(true)
        prevFilesOpenRef.current = dockOpen
    }, [dockOpen, panesMustAlternate, setConfigCollapsed])
    const prevConfigCollapsedRef = useRef(configCollapsed)
    useEffect(() => {
        if (!configCollapsed && prevConfigCollapsedRef.current && panesMustAlternate) closeDock()
        prevConfigCollapsedRef.current = configCollapsed
    }, [configCollapsed, panesMustAlternate, closeDock])
    // Shrinking past the threshold with both open keeps Files, the surface opened deliberately.
    const prevAlternateRef = useRef(panesMustAlternate)
    useEffect(() => {
        if (panesMustAlternate && !prevAlternateRef.current && dockOpen && !configCollapsed)
            setConfigCollapsed(true)
        prevAlternateRef.current = panesMustAlternate
    }, [panesMustAlternate, dockOpen, configCollapsed, setConfigCollapsed])

    // The switcher publishes its list order, so `Alt+1…9` addresses the rows it shows. A phone
    // sends no Alt chord, so mounting this on a touch surface is inert rather than harmful.
    const router = useRouter()
    const tabScope = sessionTabScope(agentId)
    const openTabIds = useAtomValue(renderedSessionTabsAtomFamily(tabScope))
    const shortcutSessions = useMemo(() => openTabIds.map((id) => ({id})), [openTabIds])
    const startBlank = useStartBlankSession(base)
    // Archiving the session you are on has to move you off it.
    const sessionActions = useSessionActions({onRemoved: useLeaveSession(base)})
    // Read from the session row the screen already caches (it carries the reader's sharing
    // state), or from the Share dialog's read; not fetched here: the first-run draft has no row.
    const isNotOwner = useCallback(
        (id: string) => {
            const client = getHostQueryClient()
            const cached =
                client.getQueryData<SessionStream | null>(sessionHeaderKey(projectId, id))
                    ?.sharing ??
                client.getQueryData<SessionSharingResponse>(sharingKeys.session(id, projectId))
                    ?.sharing
            return Boolean(cached?.policy.owner_user_id) && cached?.my_role !== "owner"
        },
        [projectId],
    )
    const requestRename = useSetAtom(sessionRenameRequestAtom)
    const setBarPanel = useSetAtom(sessionBarPanelAtom)
    useSessionShortcuts({
        sessions: shortcutSessions,
        activeId: sessionId,
        onJump: useCallback(
            (id: string) => {
                if (id !== sessionId) void router.push(sessionRoutePath(base, id))
            },
            [base, router, sessionId],
        ),
        onRename: useCallback(() => requestRename((count) => count + 1), [requestRename]),
        onArchive: useCallback(
            (id: string) => {
                // Archiving an owned chat is its owner's verb; the shortcut follows the menu.
                if (isNotOwner(id)) return
                void sessionActions.setArchived({
                    sessionId: id,
                    appId: agentId ?? null,
                    archived: false,
                })
            },
            [agentId, isNotOwner, sessionActions],
        ),
        onNewSession: useCallback(() => {
            if (agentId) startBlank(agentId)
        }, [agentId, startBlank]),
        onSearch: useCallback(() => setBarPanel("switcher"), [setBarPanel]),
        onToggleConfigPanel: useCallback(
            () => setConfigCollapsed(!configCollapsed),
            [configCollapsed, setConfigCollapsed],
        ),
        onToggleFilesPane: toggleFilesPane,
    })

    // The same surface treatment the desktop layout applies: the workspace is a recessed ground,
    // the config panel is raised above it, the conversation is the recessed canvas. Without these
    // the shared panels render flat — identical components, missing surface ladder.
    // Kept mounted and `display:none` after first use: unmounting this schema form put ~100ms
    // of main thread behind every toggle.
    const wantsConfig = showConfig && Boolean(configEntityId)
    const configMountedRef = useRef(false)
    if (wantsConfig) configMountedRef.current = true
    if (agentHidden) configMountedRef.current = false
    // The pane stays on screen for its closing slide, so it keeps the half it was already showing
    // rather than swapping content mid-motion.
    const lastPaneKindRef = useRef<"config" | "sessions">("sessions")
    if (showPane) lastPaneKindRef.current = wantsConfig ? "config" : "sessions"
    const paneKind = showPane ? (wantsConfig ? "config" : "sessions") : lastPaneKindRef.current
    // Same for the right-edge slot: a closing slide keeps what it was showing.
    const lastDockKindRef = useRef<"files" | "browser">("files")
    if (dockOpen) lastDockKindRef.current = browserOpen ? "browser" : "files"
    const pane = (
        <>
            {configMountedRef.current && configEntityId ? (
                <div
                    className={
                        configSlide.keepMounted && paneKind === "config"
                            ? "h-full min-h-0 w-full"
                            : "hidden"
                    }
                >
                    <ConfigPane
                        entityId={configEntityId}
                        sessionId={sessionId}
                        filesScope={filesScope}
                        projectId={projectId}
                    />
                </div>
            ) : null}
            {configSlide.keepMounted && paneKind === "sessions" ? (
                <SessionsPane
                    agentId={agentId}
                    agentResolving={agentResolving}
                    base={base}
                    activeSessionId={sessionId}
                />
            ) : null}
        </>
    )

    const workspace = (
        <>
            {/* Drive surfaces need the AGENT here, not just the session: without it the per-agent
                mount query stays disabled and `agent-files/…` falls back to the cwd mount, 404s,
                and the row opens nothing (#6270). Desktop mounts this; /m did not. */}
            <DriveSessionProvider sessionId={sessionId} artifactId={agentId ?? null}>
                {/* The workspace column: the shared playground top bar, then the panes under it. The
                    column owns the top safe-area inset (the bar is the topmost chrome). */}
                <div className="ag-app-ground flex h-[calc(var(--ag-viewport-height,100dvh)-var(--ag-top-bars-h,0px))] min-w-0 flex-col pt-[var(--ag-screen-safe-top,env(safe-area-inset-top))]">
                    <SessionTopBar
                        entityId={entityId}
                        sessionId={sessionId}
                        onUpdate={pinRevision}
                        agentId={agentId}
                        agentHidden={agentHidden}
                        agentResolving={agentResolving}
                        canSend={canSend}
                        hasSessions={!hideSessionSwitcher}
                        workspaceId={workspaceId}
                        projectId={projectId}
                    />

                    {/* One split at every width. On a phone the pane it does not show is CSS-hidden
                        rather than dropped, which is what keeps both halves mounted exactly once. */}
                    <div className="relative min-h-0 min-w-0 flex-1">
                        {/* Up here because the panes clip, and a pill sits across their edge. */}
                        {twoPane &&
                        !filesExpanded &&
                        configEntityId &&
                        (!hideSessionSwitcher || showConfig) ? (
                            <PaneEdgeToggle
                                side="left"
                                open={showConfig}
                                offset={showPane ? paneSize : 0}
                                animate={configSlide.animate}
                                label={showConfig ? "Hide configuration" : "Show configuration"}
                                shortcutId="panel.config"
                                onToggle={() =>
                                    showConfig ? setConfigCollapsed(true) : revealConfig()
                                }
                            />
                        ) : null}
                        {twoPane && !filesExpanded && !hideSessionSwitcher ? (
                            <PaneEdgeToggle
                                side="right"
                                open={showFiles}
                                offset={showFiles ? filesPaneSize : 0}
                                animate={filesSlide.animate}
                                label={showFiles ? "Hide side panel" : "Show files"}
                                shortcutId="panel.files"
                                onToggle={() => (showFiles ? closeDock() : toggleFilesPane())}
                            />
                        ) : null}
                        <SplitPane
                            paneSide="start"
                            paneSize={twoPane && showPane ? paneSize : 0}
                            paneMin={RIGHT_PANEL_MIN}
                            paneMax={RIGHT_PANEL_MAX}
                            // Not the desktop's 460 chat floor: `md` is 768, and 768-460 leaves
                            // the pane under its own min.
                            fillMin={420}
                            // Phone: no divider, no drag, and the visible half takes the full width.
                            animate={configSlide.animate}
                            barHidden={!twoPane || !showPane}
                            resizable={twoPane && showPane}
                            paneGrow={!twoPane && showPane}
                            paneClassName={
                                filesExpanded || (!twoPane && !showPane) ? "hidden" : undefined
                            }
                            fillClassName={!twoPane && showPane ? "hidden" : undefined}
                            // Controlled width: the drag must write through per tick, or the pane only
                            // snaps at pointer-up.
                            onResize={(size) => setPaneSize(size)}
                            onResizeEnd={(size) => setStoredPaneWidth(size)}
                            className="h-full"
                            pane={
                                <div className="h-full min-h-0" inert={!showPane}>
                                    {pane}
                                </div>
                            }
                            fill={
                                <SplitPane
                                    paneSide="end"
                                    paneSize={
                                        twoPane && dockOpen && !filesExpanded ? filesPaneSize : 0
                                    }
                                    paneMin={FILES_PANE_MIN}
                                    paneMax={FILES_PANE_MAX}
                                    // Lower than the desktop's chat floor for the same reason the
                                    // config split's is.
                                    fillMin={360}
                                    animate={filesSlide.animate}
                                    // The reveal fades the content in with the width; on a phone
                                    // the width is the screen, so there is nothing to key it on.
                                    revealContent={twoPane && !filesExpanded}
                                    // Phone: Files takes the conversation's place, as the config
                                    // pane does — no divider, no drag, full width.
                                    barHidden={filesExpanded || !twoPane || !dockOpen}
                                    resizable={!filesExpanded && twoPane && dockOpen}
                                    paneGrow={filesExpanded || (!twoPane && showFiles)}
                                    paneClassName={!twoPane && !showFiles ? "hidden" : undefined}
                                    fillClassName={
                                        filesExpanded || (!twoPane && showFiles)
                                            ? "hidden"
                                            : undefined
                                    }
                                    // Controlled width, so the drag must write through per tick or the
                                    // pane only moves at pointer-up.
                                    onResize={(size) => setFilesPaneSize(size)}
                                    onResizeEnd={(size) => setStoredFilesWidth(size)}
                                    className="h-full"
                                    pane={
                                        filesSlide.keepMounted &&
                                        lastDockKindRef.current === "browser" ? (
                                            <BrowserPane
                                                sessionId={sessionId}
                                                closeControl={twoPane ? "collapse" : "back"}
                                                onClose={() => setBrowserOpen(false)}
                                            />
                                        ) : filesSlide.keepMounted ? (
                                            <DriveLinkContext.Provider value={driveLink.copyLink}>
                                                <SessionFilesPane
                                                    scope={filesScope}
                                                    sessionId={sessionId}
                                                    onSelectionChange={driveLink.onSelectionChange}
                                                    // The session bar's icon closes the pane — on a
                                                    // phone that bar is off screen with it, so the
                                                    // pane's own control does.
                                                    closeControl={twoPane ? "none" : "back"}
                                                    expanded={filesExpanded}
                                                    onToggleExpand={filesLayout.toggleExpand}
                                                />
                                            </DriveLinkContext.Provider>
                                        ) : null
                                    }
                                    fill={
                                        <div
                                            className="ag-canvas flex h-full min-h-0"
                                            inert={filesExpanded || (!twoPane && showFiles)}
                                        >
                                            {/* Where the collapsed pane went, on a surface with no
                                                reveal in its bar: the empty column becomes the
                                                pane's own edge instead of dead canvas. Needs the
                                                width for a vertical label, so `md` up. */}
                                            {hideSessionSwitcher &&
                                            twoPane &&
                                            !chatMaximized &&
                                            configCollapsed ? (
                                                <CollapsedConfigRail />
                                            ) : null}
                                            <div className="min-h-0 min-w-0 flex-1">{chat}</div>
                                        </div>
                                    }
                                />
                            }
                        />
                    </div>
                </div>
                <CatalogDrawer />
                <AutomationDrawer />
                <AutomationRunHistoryDrawerHost workspaceId={workspaceId} projectId={projectId} />
            </DriveSessionProvider>
        </>
    )

    if (bare) return workspace
    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {workspace}
        </AppShell>
    )
}
