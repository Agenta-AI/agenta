import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
} from "react"

import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {workflowMolecule} from "@agenta/entities/workflow"
import {DriveSessionProvider} from "@agenta/entity-ui/drive"
import {workflowRevisionDrawerOpenAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {
    pendingSessionOpensAtom,
    removePendingSessionOpensAtom,
    type PendingSessionOpen,
} from "@agenta/sessions/state"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {paneSlideHoldMs, SplitPane} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {SessionFilesPane, useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"
import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"

// Direct file import — the barrel would statically pull the inspector drawer into this chunk.
import {ConversationSkeleton, SessionBarSkeleton} from "./components/AgentChatSkeleton"
import InspectSessionButton from "./components/Inspector/InspectSessionButton"
import MountFade from "./components/MountFade"
import OpenFilesPaneButton from "./components/OpenFilesPaneButton"
import RightPanelSplit from "./components/RightPanel/RightPanelSplit"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import ShowConfigPanelButton from "./components/ShowConfigPanelButton"
import {useSessionActions} from "./hooks/useSessionActions"
import {useSessionShortcuts} from "./hooks/useSessionShortcuts"
import {useReconcileServerSessions} from "./state/projectSessions"
import {
    FILES_PANE_MAX,
    FILES_PANE_MIN,
    filesPaneWidthAtom,
    PANES_COEXIST_MIN_WINDOW,
} from "./state/rightPanel"
import {isDrawerScopeKey, useChatScopeKey} from "./state/scope"
import {
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    adoptSessionAtomFamily,
    closeSessionAtomFamily,
    pruneSessionHusksAtomFamily,
    renameSessionAtomFamily,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
} from "./state/sessions"
import {
    focusComposerRequestAtom,
    renameSessionRequestAtom,
    sessionSearchRequestAtom,
} from "./state/uiRequests"

// The frame itself is a thin, synchronous shell (Splitter + Tabs + region slots) so the real
// structure paints in the first frame. Only the heavy leaves are lazy: the conversation body
// (useChat + AI SDK + transport + message tree), the session bar, and the rail. Each shows its
// own inline skeleton and eases in (MountFade) — no whole-pane crossfade overlay.
const AgentConversation = lazy(() => import("./AgentConversation"))
const SessionTagBar = lazy(() => import("./components/SessionTagBar"))
const SessionRail = lazy(() => import("./components/SessionRail"))

/** Chat-mode session rail: default/min/max widths of its resizable splitter pane. The pane
 * collapses to 0 in build mode (rather than unmounting) so the Build/Chat toggle animates in
 * lockstep with the config pane. Min also pins the rail's content width, so collapsing clips
 * instead of squishing. */
const RAIL_WIDTH = 300
const RAIL_MIN_WIDTH = 240
const RAIL_MAX_WIDTH = 480

// Media-query subscription for the coexistence threshold (window width, not container width, on
// purpose: the rule assumes the nav sidebar at its default width, per the threshold's derivation).
const coexistMediaQuery = () => window.matchMedia(`(min-width: ${PANES_COEXIST_MIN_WINDOW}px)`)
const subscribeCoexist = (onChange: () => void) => {
    const mql = coexistMediaQuery()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
}
/** True when the window fits config pane + transcript + Files pane together at fair widths. */
const useCanPanesCoexist = () =>
    useSyncExternalStore(
        subscribeCoexist,
        () => coexistMediaQuery().matches,
        () => false,
    )

/**
 * AgentChatPanel — the agent-generation surface hosted INSIDE the playground (the third
 * generation arm beside chat and completion).
 *
 * Single view keeps the slice's session tab bar (design decision D2): parallel conversations,
 * add with `+`, close with `×`, double-click to rename — rendered as a row of status-dotted tags
 * (`SessionTagBar`) whose bottom edge aligns with the config panel header. Sessions are app-scoped
 * (shared with the rest of the playground) and persist to localStorage, so tabs survive a reload;
 * antd keeps visited panes mounted (we only swap the bar via `renderTabBar`), so switching tabs
 * preserves a session's live stream / approval state. Each tab is its own `useChat` driven by
 * `buildAgentRequest` against the current `entityId` (so the run always uses the live draft config).
 */
const AgentChatPanel = ({entityId}: {entityId: string}) => {
    const scope = useChatScopeKey()
    // Pre-commit onboarding: one ephemeral session, no multi-session UX — hide the whole session bar
    // (tabs / new / search / history). Stays hidden through the commit + first send, then eases in a beat
    // later (`chromeRevealed`) so the bar doesn't push the transcript down mid-send.
    const onboarding = useOptionalOnboardingContext()
    const chromeHidden = !!onboarding && !onboarding.chromeRevealed
    // Onboarding keeps the user with the founding conversation until its first run settles.
    const addLocked = !!onboarding?.newSessionLocked
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const closeSession = useSetAtom(closeSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))
    // Stable identity: the tag bar forwards this straight to each memo'd chip.
    const handleRename = useCallback(
        (id: string, title: string) => renameSession({id, title}),
        [renameSession],
    )
    const pruneSessionHusks = useSetAtom(pruneSessionHusksAtomFamily(scope))
    // Fold the agent's server session list into the local cache (adopt cross-device / post-wipe,
    // enrich titles, drop remotely-deleted) — the scope key is the agent's appId (artifact id).
    useReconcileServerSessions(scope)
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    const configPanelCollapsed = useAtomValue(configPanelCollapsedAtom)
    const setConfigPanelCollapsed = useSetAtom(configPanelCollapsedAtom)
    // The rail pane is `size={0}` + `inert` until maximized, so mounting it on boot renders the
    // whole session list (rows, dots, hover actions) into a zero-width panel. Latch it on first
    // open and keep it mounted after, so toggling back and forth doesn't remount or lose scroll.
    const [railMounted, setRailMounted] = useState(chatMaximized)
    useEffect(() => {
        if (chatMaximized) setRailMounted(true)
    }, [chatMaximized])
    // Shared entrance latch: the composer's Reveal plays for the first conversation this
    // panel mounts; every additional session pane skips it (no per-switch flash).
    const composerRevealPlayedRef = useRef(false)

    // Sessions opened from a project-wide surface (sessions page, Home) land here after the nav.
    // Adopt them so a session this browser has never seen becomes a real tab; its transcript then
    // hydrates from records. EVERY queued entry for this scope is consumed — two rapid creates are
    // two sessions, not an overwrite (#6042).
    const pendingOpens = useAtomValue(pendingSessionOpensAtom)
    const removePendingOpens = useSetAtom(removePendingSessionOpensAtom)
    const adoptSession = useSetAtom(adoptSessionAtomFamily(scope))
    const pendingOpensForScope = useMemo(
        () => pendingOpens.filter((t) => t.appId === scope),
        [pendingOpens, scope],
    )
    // Strict Mode replays this effect with the same captured values; the ref stops the replay
    // adding the same session twice before the atom write lands.
    const consumedOpensRef = useRef(new Set<PendingSessionOpen>())
    useEffect(() => {
        const fresh = pendingOpensForScope.filter((t) => !consumedOpensRef.current.has(t))
        if (fresh.length === 0) return
        for (const target of fresh) {
            consumedOpensRef.current.add(target)
            if (target.sessionId) {
                adoptSession({id: target.sessionId, title: target.title})
            } else {
                // No id means "start a fresh conversation here" — Home's composer. It may name the
                // session up front, so the message it sent along lands in this one and no other.
                addSession({id: target.newSessionId})
            }
        }
        removePendingOpens(fresh)
    }, [pendingOpensForScope, adoptSession, addSession, removePendingOpens])

    // Always keep at least one tab. Re-arms when the list drains without double-firing
    // under StrictMode. Held while a deep-linked session is pending: adopting it satisfies the
    // at-least-one-tab rule, and seeding first would leave a stray blank tab beside it.
    const seeded = useRef(false)
    useEffect(() => {
        if (pendingOpensForScope.length > 0) return
        if (sessions.length === 0 && !seeded.current) {
            seeded.current = true
            addSession()
        }
        if (sessions.length > 0) seeded.current = false
    }, [sessions.length, addSession, pendingOpensForScope])

    // Sweep husks (never-run, untitled, empty sessions) that accumulated in history — from before
    // the close-time cleanup, or orphaned by a reload. Open tabs are untouched, so this never drops
    // the blank tab you're about to type in.
    useEffect(() => {
        pruneSessionHusks()
    }, [pruneSessionHusks])

    // Tolerate a stale active id (its tab was closed) by falling back to the first tab.
    const activeId = sessions.some((s) => s.id === rawActiveId) ? rawActiveId : sessions[0]?.id

    // Keyboard shortcuts. Switch and rename happen inside per-session components, so they travel as
    // requests on the shared atoms. The drawer mounts a second panel over this one, so exactly one
    // of the two listens; onboarding hides the bar entirely and allows a single session.
    const {setArchived} = useSessionActions()
    const requestComposerFocus = useSetAtom(focusComposerRequestAtom)
    const requestRename = useSetAtom(renameSessionRequestAtom)
    const requestSessionSearch = useSetAtom(sessionSearchRequestAtom)
    const drawerOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    useSessionShortcuts({
        sessions,
        activeId,
        enabled: !chromeHidden && isDrawerScopeKey(scope) === drawerOpen,
        onJump: useCallback(
            (id: string) => {
                setActiveSession(id)
                requestComposerFocus({scope, sessionId: id, nonce: Date.now()})
            },
            [scope, setActiveSession, requestComposerFocus],
        ),
        onRename: useCallback(
            (id: string) => requestRename({scope, sessionId: id, nonce: Date.now()}),
            [scope, requestRename],
        ),
        onArchive: useCallback(
            (id: string) => {
                const session = sessions.find((s) => s.id === id)
                if (session) void setArchived({sessionId: id, appId: scope, name: session.title})
            },
            [sessions, scope, setArchived],
        ),
        onNewSession: useCallback(() => {
            if (!addLocked) addSession()
        }, [addLocked, addSession]),
        onCloseSession: closeSession,
        // Toggles: the list opens with the caret already in the search box, and the same key puts
        // it away.
        onSearch: useCallback(() => {
            if (chatMaximized) {
                setChatMaximized(false)
                return
            }
            setChatMaximized(true)
            requestSessionSearch({scope, nonce: Date.now()})
        }, [chatMaximized, scope, setChatMaximized, requestSessionSearch]),
        onToggleConfigPanel: useCallback(
            () => setConfigPanelCollapsed(!configPanelCollapsed),
            [configPanelCollapsed, setConfigPanelCollapsed],
        ),
    })

    // Docked Files pane — a full-height sibling of the WHOLE chat column (session bar included),
    // like the config pane on the other side: its divider runs to the top and the session bar
    // stays confined to the chat. Follows the ACTIVE session (openers set per-session atoms).
    const filesPane = useSessionFilesPane(activeId ?? "")
    // Workflow artifact id — the key for the agent's durable `agent-files` mount; the pane's
    // DriveSessionProvider needs it here because it sits OUTSIDE the per-tab conversations.
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(entityId))

    // On windows too narrow to fit config pane + transcript + Files pane at fair widths, the two
    // side panes are mutually exclusive: opening one collapses the other, so the transcript always
    // keeps room. Wide windows skip the eviction and let both stay open. Transition-edge effects
    // (prev refs), not state syncs — each watches only the flip that should evict the other, so
    // they can't ping-pong.
    const canPanesCoexist = useCanPanesCoexist()
    const prevFilesOpenRef = useRef(filesPane.open)
    useEffect(() => {
        if (filesPane.open && !prevFilesOpenRef.current && !canPanesCoexist)
            setConfigPanelCollapsed(true)
        prevFilesOpenRef.current = filesPane.open
    }, [filesPane.open, canPanesCoexist, setConfigPanelCollapsed])
    const closeFilesPane = filesPane.close
    const prevConfigCollapsedRef = useRef(configPanelCollapsed)
    useEffect(() => {
        if (!configPanelCollapsed && prevConfigCollapsedRef.current && !canPanesCoexist)
            closeFilesPane()
        prevConfigCollapsedRef.current = configPanelCollapsed
    }, [configPanelCollapsed, canPanesCoexist, closeFilesPane])
    // Shrinking below the threshold with BOTH open: keep the Files pane (the content surface the
    // user opened deliberately) and collapse the config pane — the same choice opening Files makes.
    const prevCoexistRef = useRef(canPanesCoexist)
    useEffect(() => {
        if (!canPanesCoexist && prevCoexistRef.current && filesPane.open && !configPanelCollapsed)
            setConfigPanelCollapsed(true)
        prevCoexistRef.current = canPanesCoexist
    }, [canPanesCoexist, filesPane.open, configPanelCollapsed, setConfigPanelCollapsed])

    // A trigger test asks for a fresh session: create + activate one, then clear the flag so the
    // new session's conversation consumes the turn (the per-session consumer skips flagged runs).
    const pendingRun = useAtomValue(simulatedAgentRunAtomFamily(entityId))
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId))
    const newSessionNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!pendingRun?.newSession) return
        if (newSessionNonceRef.current === pendingRun.nonce) return
        newSessionNonceRef.current = pendingRun.nonce
        addSession()
        setPendingRun({text: pendingRun.text, nonce: pendingRun.nonce})
    }, [pendingRun, addSession, setPendingRun])

    // Same render-time toggle detection as MainLayout's config pane: the `-animated` class must land
    // in the SAME commit as the size flip (else it snaps), then held ~280ms; off during drag/resize.
    const prevMaximizedRef = useRef(chatMaximized)
    const [holdAnimate, setHoldAnimate] = useState(false)
    // Rail pane is controlled: 0 while collapsed (build mode), the dragged width while open.
    // Keeping `size` always defined + an `onResize` satisfies antd's controlled-Splitter contract.
    const [railSize, setRailSize] = useState<number>(RAIL_WIDTH)
    const justToggled = prevMaximizedRef.current !== chatMaximized
    // Deps = toggle value ONLY: with `justToggled` in deps, the holdAnimate re-render re-ran the
    // effect and its cleanup cancelled the timer — the class stuck on and every drag lagged.
    useEffect(() => {
        if (prevMaximizedRef.current === chatMaximized) return
        prevMaximizedRef.current = chatMaximized
        setHoldAnimate(true)
        const t = setTimeout(() => setHoldAnimate(false), paneSlideHoldMs())
        return () => clearTimeout(t)
    }, [chatMaximized])
    const animateRailSplit = justToggled || holdAnimate

    // antd Tabs semantics, hand-rolled: a pane mounts on FIRST activation and stays mounted
    // (hidden) afterwards, so switching tabs preserves a session's live useChat stream. Rendering
    // every session eagerly would boot every conversation at once; unmounting on switch would
    // kill the stream — the visited set is exactly antd's lazy-then-keep contract.
    const visitedRef = useRef<Set<string>>(new Set())
    if (activeId) visitedRef.current.add(activeId)

    return (
        // The rail gets the SAME resizable splitter treatment as the build-mode config pane (gutter
        // bar + grip). It lives INSIDE the chat panel (not MainLayout's config pane) on purpose: the
        // revision drawer also hosts this panel with its own chat scope, and the rail must follow it.
        <SplitPane
            paneSide="start"
            paneSize={chatMaximized ? railSize : 0}
            paneMin={chatMaximized ? RAIL_MIN_WIDTH : 0}
            paneMax={RAIL_MAX_WIDTH}
            fillMin={320}
            resizable={chatMaximized}
            animate={animateRailSplit}
            barHidden={!chatMaximized}
            className="h-full min-h-0 min-w-0 w-full"
            onResize={(size) => {
                if (chatMaximized) setRailSize(size)
            }}
            pane={
                /* `inert` drops the clipped rail from tab order + a11y while collapsed. Flex-bounded
                   (not a plain h-full cascade) so the rail's session list actually scrolls — a bare
                   h-full chain through the fade wrapper grew with content and never bounded. */
                <div className="flex h-full min-h-0 w-full flex-col" inert={!chatMaximized}>
                    {/* Rail pane is width-0 unless maximized, so no visible fallback is needed. */}
                    <Suspense fallback={null}>
                        {/* min-w matches RAIL_MIN_WIDTH (Tailwind needs the literal). */}
                        {railMounted && (
                            <MountFade className="flex min-h-0 w-full flex-1 flex-col">
                                <SessionRail
                                    activeId={activeId}
                                    addDisabled={addLocked}
                                    className="min-h-0 w-full min-w-[240px] flex-1"
                                />
                            </MountFade>
                        )}
                    </Suspense>
                </div>
            }
            fill={
                /* [chat column | Files pane] — the pane pushes the tabs (bar included) aside and
                   collapses to 0; the bar's "«" and the pane header's "»" both drive it. */
                <RightPanelSplit
                    open={filesPane.open}
                    widthAtom={filesPaneWidthAtom}
                    min={FILES_PANE_MIN}
                    max={FILES_PANE_MAX}
                    panel={
                        activeId ? (
                            <DriveSessionProvider sessionId={activeId} artifactId={artifactId}>
                                <SessionFilesPane sessionId={activeId} />
                            </DriveSessionProvider>
                        ) : null
                    }
                >
                    <div
                        // The session bar is an ABSOLUTE overlay pinned top, so its presence never
                        // reflows the content. The build↔chat motion is published as a CSS var
                        // (`--agent-bar-inset`: 48 in build, 0 in chat) that the TRANSCRIPT column
                        // consumes as its top padding — so only the transcript eases, not the context
                        // rail beside it.
                        style={
                            {
                                "--agent-bar-inset": chromeHidden || chatMaximized ? "0px" : "48px",
                            } as CSSProperties
                        }
                        className="relative flex h-full min-h-0 min-w-0 w-full flex-col"
                    >
                        {/* The bar overlay: absolute (out of flow), bounded to the pane width so tabs
                        scroll; fades out in chat mode / onboarding while the content padding animates. */}
                        <div
                            className="absolute inset-x-0 top-0 z-10 min-w-0 overflow-hidden motion-safe:transition-opacity motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
                            style={{
                                opacity: chromeHidden || chatMaximized ? 0 : 1,
                                pointerEvents: chromeHidden || chatMaximized ? "none" : undefined,
                            }}
                            // opacity/pointerEvents hide it visually + for the mouse; `inert` also drops
                            // the hidden tabs from keyboard tab order + a11y (mirrors the rail above).
                            inert={chromeHidden || chatMaximized}
                        >
                            {/* Region fallback = the same bar skeleton the pre-confirmation gate
                            renders, so the strip's lane holds its shape while this chunk loads; the
                            real bar eases in over it (MountFade) instead of popping. */}
                            <Suspense fallback={<SessionBarSkeleton />}>
                                <MountFade>
                                    <SessionTagBar
                                        sessions={sessions}
                                        activeId={activeId}
                                        onSelect={setActiveSession}
                                        onAdd={addSession}
                                        addDisabled={addLocked}
                                        onClose={closeSession}
                                        onRename={handleRename}
                                        showSessions={!chatMaximized}
                                        leftExtra={
                                            !chatMaximized && configPanelCollapsed ? (
                                                <ShowConfigPanelButton />
                                            ) : undefined
                                        }
                                        extra={
                                            chatMaximized ? undefined : (
                                                <>
                                                    <InspectSessionButton
                                                        sessionId={activeId ?? null}
                                                    />
                                                    <SessionHistoryMenu />
                                                    <OpenFilesPaneButton
                                                        sessionId={activeId ?? null}
                                                    />
                                                </>
                                            )
                                        }
                                    />
                                </MountFade>
                            </Suspense>
                        </div>
                        <div className="min-h-0 w-full flex-1">
                            {sessions.map((session) => {
                                if (!visitedRef.current.has(session.id)) return null
                                const active = session.id === activeId
                                return (
                                    <div
                                        key={session.id}
                                        className={active ? "h-full min-h-0 w-full" : "hidden"}
                                    >
                                        {/* The heavy conversation body hydrates behind its own
                                        transcript/composer skeleton and eases in over it. */}
                                        <Suspense fallback={<ConversationSkeleton />}>
                                            <MountFade className="h-full min-h-0 w-full">
                                                <AgentConversation
                                                    entityId={entityId}
                                                    sessionId={session.id}
                                                    revealPlayedRef={composerRevealPlayedRef}
                                                />
                                            </MountFade>
                                        </Suspense>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </RightPanelSplit>
            }
        />
    )
}

export default AgentChatPanel
