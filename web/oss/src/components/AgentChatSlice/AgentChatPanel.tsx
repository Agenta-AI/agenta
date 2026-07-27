import {lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties} from "react"

import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {Splitter, Tabs} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"

// Direct file import — the barrel would statically pull the inspector drawer into this chunk.
import {ConversationSkeleton, SessionBarSkeleton} from "./components/AgentChatSkeleton"
import InspectSessionButton from "./components/Inspector/InspectSessionButton"
import MountFade from "./components/MountFade"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import {chatPanelMaximizedAtom} from "./state/panelLayout"
import {useChatScopeKey} from "./state/scope"
import {
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    closeSessionAtomFamily,
    pruneSessionHusksAtomFamily,
    renameSessionAtomFamily,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
} from "./state/sessions"

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
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
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

    // Always keep at least one tab. Re-arms when the list drains without double-firing
    // under StrictMode.
    const seeded = useRef(false)
    useEffect(() => {
        if (sessions.length === 0 && !seeded.current) {
            seeded.current = true
            addSession()
        }
        if (sessions.length > 0) seeded.current = false
    }, [sessions.length, addSession])

    // Sweep husks (never-run, untitled, empty sessions) that accumulated in history — from before
    // the close-time cleanup, or orphaned by a reload. Open tabs are untouched, so this never drops
    // the blank tab you're about to type in.
    useEffect(() => {
        pruneSessionHusks()
    }, [pruneSessionHusks])

    // Tolerate a stale active id (its tab was closed) by falling back to the first tab.
    const activeId = sessions.some((s) => s.id === rawActiveId) ? rawActiveId : sessions[0]?.id

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
        const t = setTimeout(() => setHoldAnimate(false), 280)
        return () => clearTimeout(t)
    }, [chatMaximized])
    const animateRailSplit = justToggled || holdAnimate

    return (
        // The rail gets the SAME resizable splitter treatment as the build-mode config pane (gutter
        // bar + grip). It lives INSIDE the chat panel (not MainLayout's config pane) on purpose: the
        // revision drawer also hosts this panel with its own chat scope, and the rail must follow it.
        <Splitter
            className={clsx(
                "h-full min-h-0 min-w-0 w-full playground-splitter playground-splitter-agent",
                {
                    // Build mode: rail pane pinned to 0, bar hidden — mirrors the config pane's collapse.
                    "playground-splitter-collapsed": !chatMaximized,
                    "playground-splitter-animated": animateRailSplit,
                },
            )}
            onResize={(sizes) => {
                if (chatMaximized) setRailSize(sizes[0])
            }}
        >
            <Splitter.Panel
                defaultSize={RAIL_WIDTH}
                size={chatMaximized ? railSize : 0}
                min={RAIL_MIN_WIDTH}
                max={RAIL_MAX_WIDTH}
                collapsible={false}
                className="!overflow-hidden !p-0"
            >
                {/* `inert` drops the clipped rail from tab order + a11y while collapsed. Flex-bounded
                    (not a plain h-full cascade) so the rail's session list actually scrolls — a bare
                    h-full chain through the fade wrapper grew with content and never bounded. */}
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
            </Splitter.Panel>
            <Splitter.Panel collapsible={false} className="!overflow-hidden !p-0">
                <Tabs
                    animated={false}
                    // The session bar is an ABSOLUTE overlay (`.ant-tabs-nav` pinned top) so its
                    // presence never reflows the content. The build↔chat motion is published as a
                    // CSS var (`--agent-bar-inset`: 48 in build, 0 in chat) that the TRANSCRIPT column
                    // consumes as its top padding — so only the transcript eases, not the context rail
                    // beside it (which the shared content-holder padding used to drag up too).
                    style={
                        {
                            "--agent-bar-inset": chromeHidden || chatMaximized ? "0px" : "48px",
                        } as CSSProperties
                    }
                    className="relative flex h-full min-h-0 min-w-0 w-full flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-nav]:!mb-0"
                    activeKey={activeId}
                    onChange={setActiveSession}
                    renderTabBar={() => (
                        // renderTabBar's node stands in for the nav, so making IT absolute (pinned top,
                        // bounded to the pane width) takes the bar out of flow — the transcript no longer
                        // reflows when it appears, and the strip has a bounded width so tabs scroll. It just
                        // fades (opacity) out in chat mode / onboarding while the content padding animates.
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
                                        extra={
                                            chatMaximized ? undefined : (
                                                <>
                                                    <InspectSessionButton
                                                        sessionId={activeId ?? null}
                                                    />
                                                    <SessionHistoryMenu />
                                                </>
                                            )
                                        }
                                    />
                                </MountFade>
                            </Suspense>
                        </div>
                    )}
                    items={sessions.map((session) => ({
                        key: session.id,
                        // Bar is rendered by `renderTabBar` (SessionTagBar); the per-item label is unused.
                        label: null,
                        children: (
                            // The heavy conversation body hydrates behind its own transcript/composer
                            // skeleton (same shape the frame reserves) and eases in over it.
                            <Suspense fallback={<ConversationSkeleton />}>
                                <MountFade className="h-full min-h-0 w-full">
                                    <AgentConversation
                                        entityId={entityId}
                                        sessionId={session.id}
                                        revealPlayedRef={composerRevealPlayedRef}
                                    />
                                </MountFade>
                            </Suspense>
                        ),
                    }))}
                />
            </Splitter.Panel>
        </Splitter>
    )
}

export default AgentChatPanel
