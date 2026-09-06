import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    FILES_PANE_MAX,
    FILES_PANE_MIN,
    filesPaneWidthAtom,
    RIGHT_PANEL_MAX,
    RIGHT_PANEL_MIN,
    rightPanelWidthAtom,
    useCanPanesCoexist,
} from "@agenta/chat/state"
import {DriveSessionProvider, SessionFilesPane, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {SIDEBAR_DEFAULT_WIDTH} from "@agenta/navigation"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {sessionRoutePath} from "@agenta/sessions/link"
import {renderedSessionTabsAtomFamily, sessionTabScope} from "@agenta/sessions/state"
import {useRequestSessionTabRename, useSessionActions} from "@agenta/sessions-ui"
import {useMediaQuery} from "@agenta/ui/hooks"
import {useSessionShortcuts} from "@agenta/ui/shortcuts"
import {SplitPane, usePaneSlide} from "@agenta/ui/ui"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {AppShell} from "../nav/AppShell"

import {selectedRevisionAtomFamily} from "./selectedRevision"
import {resolveSessionPanes} from "./sessionPanes"
import {SessionsPane} from "./SessionsPane"
import {SessionTabs} from "./SessionTabs"
import {SessionTopBar} from "./SessionTopBar"
import {useSessionTabClose} from "./useSessionTabClose"
import {useStartBlankSession} from "./useStartBlankSession"

// Build's config panel carries the whole schema-form surface (DrillInView + the editor). Chat
// mode never renders it, so it loads on demand instead of riding in the session page's bundle —
// the panel is behind an explicit mode switch, so a chunk fetch on that click is invisible.
const ConfigPane = dynamic(() => import("./ConfigPane").then((m) => m.ConfigPane), {
    ssr: false,
})

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
    sessionId,
    workspaceId,
    projectId,
    chat,
}: {
    /** The revision being configured. Absent = nothing to build yet (a session with no turns). */
    entityId: string | null
    agentId?: string | null
    sessionId: string
    workspaceId: string
    projectId: string
    /** The conversation, rendered embedded (it brings its own header, dock and composer). */
    chat: ReactNode
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
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

    const configCollapsed = useAtomValue(configPanelCollapsedAtom)
    // Files dock as a resizable right-edge pane, as they do on the desktop, rather than an
    // overlay drawer. Scope is the AGENT, not the session: opening files then switching session
    // must not snap the pane shut.
    const filesScope = agentId ?? sessionId
    const {
        open: filesOpen,
        close: closeFilesPane,
        toggle: toggleFilesPane,
    } = useSessionFilesPane(filesScope, sessionId)
    // Tailwind's `md`. Client-only, so the first paint is the phone layout — the right guess here.
    const twoPane = useMediaQuery("(min-width: 768px)")
    // Which half is on screen. The rule is in `sessionPanes.ts`, with its tests: on a phone the
    // pane replaces the conversation, so getting it wrong puts the composer out of reach.
    const {showConfig, showPane} = resolveSessionPanes({
        chatMaximized,
        configCollapsed,
        twoPane,
        hasEntity: Boolean(entityId),
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
    const configSlide = usePaneSlide(showPane)
    const filesSlide = usePaneSlide(twoPane && filesOpen)

    // The desktop's coexistence rule, same threshold: too narrow to seat the config pane, the
    // transcript and the Files pane at fair widths, so the two side panes take turns and the
    // transcript keeps its floor. Only meaningful in two-pane layouts — below `md` the panes
    // already alternate. Transition-edge effects, so they cannot evict each other in a loop.
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)
    const canPanesCoexist = useCanPanesCoexist(SIDEBAR_DEFAULT_WIDTH)
    const panesMustAlternate = twoPane && !canPanesCoexist
    const prevFilesOpenRef = useRef(filesOpen)
    useEffect(() => {
        if (filesOpen && !prevFilesOpenRef.current && panesMustAlternate) setConfigCollapsed(true)
        prevFilesOpenRef.current = filesOpen
    }, [filesOpen, panesMustAlternate, setConfigCollapsed])
    const prevConfigCollapsedRef = useRef(configCollapsed)
    useEffect(() => {
        if (!configCollapsed && prevConfigCollapsedRef.current && panesMustAlternate)
            closeFilesPane()
        prevConfigCollapsedRef.current = configCollapsed
    }, [configCollapsed, panesMustAlternate, closeFilesPane])
    // Shrinking past the threshold with both open keeps Files, the surface opened deliberately.
    const prevAlternateRef = useRef(panesMustAlternate)
    useEffect(() => {
        if (panesMustAlternate && !prevAlternateRef.current && filesOpen && !configCollapsed)
            setConfigCollapsed(true)
        prevAlternateRef.current = panesMustAlternate
    }, [panesMustAlternate, filesOpen, configCollapsed, setConfigCollapsed])

    // The SAME session shortcuts the desktop playground binds. The rail publishes the tabs it
    // renders, so `Alt+1…9` addresses exactly what is on screen. A phone sends no Alt chord, so
    // mounting this on a touch surface is inert rather than harmful.
    const router = useRouter()
    const tabScope = sessionTabScope(agentId)
    const openTabIds = useAtomValue(renderedSessionTabsAtomFamily(tabScope))
    const shortcutSessions = useMemo(() => openTabIds.map((id) => ({id})), [openTabIds])
    const startBlank = useStartBlankSession(base)
    const closeTabs = useSessionTabClose({agentId, sessionId, base})
    const sessionActions = useSessionActions()
    // Alt+R opens the active TAB's inline editor — the rail listens for this request.
    const requestTabRename = useRequestSessionTabRename()
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    useSessionShortcuts({
        sessions: shortcutSessions,
        activeId: sessionId,
        onJump: useCallback(
            (id: string) => {
                if (id !== sessionId) void router.push(sessionRoutePath(base, id))
            },
            [base, router, sessionId],
        ),
        onRename: requestTabRename,
        onArchive: useCallback(
            (id: string) =>
                void sessionActions.setArchived({
                    sessionId: id,
                    appId: agentId ?? null,
                    archived: false,
                }),
            [agentId, sessionActions],
        ),
        onNewSession: useCallback(() => {
            if (agentId) startBlank(agentId)
        }, [agentId, startBlank]),
        onCloseSession: useCallback(
            (id: string) => closeTabs([id], openTabIds),
            [closeTabs, openTabIds],
        ),
        // No search box in the sessions pane yet — reveal the pane, which is the half of the
        // desktop's binding that exists here.
        onSearch: useCallback(
            () => setChatMaximized(!chatMaximized),
            [chatMaximized, setChatMaximized],
        ),
        onToggleConfigPanel: useCallback(
            () => setConfigCollapsed(!configCollapsed),
            [configCollapsed, setConfigCollapsed],
        ),
        onToggleFilesPane: toggleFilesPane,
    })

    // The same surface treatment the desktop layout applies: the workspace is a recessed ground,
    // the config panel is raised above it, the conversation is the recessed canvas. Without these
    // the shared panels render flat — identical components, missing surface ladder.
    //
    // The config surface is a whole schema form, so unmounting it on a toggle put ~100ms of main
    // thread behind every one. It mounts on first use (the `next/dynamic` chunk still loads on
    // demand) and is `display:none` after that, as the desktop's session panes are.
    const wantsConfig = showConfig && Boolean(entityId)
    const configMountedRef = useRef(false)
    if (wantsConfig) configMountedRef.current = true
    // The pane stays on screen for its closing slide, so it keeps the half it was already showing
    // rather than swapping content mid-motion.
    const lastPaneKindRef = useRef<"config" | "sessions">("sessions")
    if (showPane) lastPaneKindRef.current = wantsConfig ? "config" : "sessions"
    const paneKind = showPane ? (wantsConfig ? "config" : "sessions") : lastPaneKindRef.current
    const pane = (
        <>
            {configMountedRef.current && entityId ? (
                <div
                    className={
                        configSlide.keepMounted && paneKind === "config"
                            ? "h-full min-h-0 w-full"
                            : "hidden"
                    }
                >
                    <ConfigPane entityId={entityId} sessionId={sessionId} />
                </div>
            ) : null}
            {configSlide.keepMounted && paneKind === "sessions" ? (
                <SessionsPane agentId={agentId} base={base} activeSessionId={sessionId} />
            ) : null}
        </>
    )

    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {/* Drive surfaces need the AGENT here, not just the session: without it the per-agent
                mount query stays disabled and `agent-files/…` falls back to the cwd mount, 404s,
                and the row opens nothing (#6270). Desktop mounts this; /m did not. */}
            <DriveSessionProvider sessionId={sessionId} artifactId={agentId ?? null}>
                {/* The workspace column: the shared playground top bar, then the panes under it. The
                    column owns the top safe-area inset (the bar is the topmost chrome). */}
                <div className="ag-app-ground flex h-[var(--ag-viewport-height,100dvh)] min-w-0 flex-col pt-[env(safe-area-inset-top)]">
                    <SessionTopBar
                        entityId={entityId}
                        agentId={agentId}
                        workspaceId={workspaceId}
                        projectId={projectId}
                    />

                    {/* One split at every width. On a phone the pane it does not show is CSS-hidden
                        rather than dropped, which is what keeps both halves mounted exactly once. */}
                    <div className="min-h-0 min-w-0 flex-1">
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
                            paneClassName={!twoPane && !showPane ? "hidden" : undefined}
                            fillClassName={!twoPane && showPane ? "hidden" : undefined}
                            // Controlled width: the drag must write through per tick, or the pane only
                            // snaps at pointer-up.
                            onResize={(size) => setPaneSize(size)}
                            onResizeEnd={(size) => setStoredPaneWidth(size)}
                            className="h-full"
                            pane={pane}
                            fill={
                                <SplitPane
                                    paneSide="end"
                                    paneSize={twoPane && filesOpen ? filesPaneSize : 0}
                                    paneMin={FILES_PANE_MIN}
                                    paneMax={FILES_PANE_MAX}
                                    // Lower than the desktop's chat floor for the same reason the
                                    // config split's is.
                                    fillMin={360}
                                    animate={filesSlide.animate}
                                    barHidden={!twoPane || !filesOpen}
                                    resizable={twoPane && filesOpen}
                                    // Controlled width, so the drag must write through per tick or the
                                    // pane only moves at pointer-up.
                                    onResize={(size) => setFilesPaneSize(size)}
                                    onResizeEnd={(size) => setStoredFilesWidth(size)}
                                    className="h-full"
                                    pane={
                                        filesSlide.keepMounted ? (
                                            <SessionFilesPane
                                                scope={filesScope}
                                                sessionId={sessionId}
                                            />
                                        ) : null
                                    }
                                    fill={
                                        <div className="ag-canvas flex h-full min-h-0 flex-col">
                                            {/* The rail belongs to the WORKSPACE, not to one
                                                conversation. It used to live inside the conversation's
                                                pinned header, so keying that per session remounted the
                                                rail too and reset its scroll to 0 — you would scroll a
                                                long strip, pick a tab, and the strip snapped back to
                                                the start. Up here it simply stays put. */}
                                            <SessionTabs
                                                sessionId={sessionId}
                                                projectId={projectId}
                                                workspaceId={workspaceId}
                                                agentId={agentId}
                                            />
                                            <div className="min-h-0 flex-1">{chat}</div>
                                        </div>
                                    }
                                />
                            }
                        />
                    </div>
                </div>
            </DriveSessionProvider>
        </AppShell>
    )
}
