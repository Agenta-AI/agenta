import {lazy, Suspense, useEffect, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {Splitter, Tabs} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
// Direct file import — the barrel would statically pull the inspector drawer into this chunk.
import SessionInspectorButton from "@/oss/components/SessionInspector/SessionInspectorButton"

import {ConversationSkeleton, SessionBarSkeleton} from "./components/AgentChatSkeleton"
import MountFade from "./components/MountFade"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import {chatPanelMaximizedAtom} from "./state/panelLayout"
import {useChatScopeKey} from "./state/scope"
import {
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    closeSessionAtomFamily,
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
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(entityId))
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
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
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
        >
            <Splitter.Panel
                defaultSize={RAIL_WIDTH}
                size={chatMaximized ? undefined : 0}
                min={RAIL_MIN_WIDTH}
                max={RAIL_MAX_WIDTH}
                collapsible={false}
                className="!overflow-hidden !p-0"
            >
                {/* `inert` drops the clipped rail from tab order + a11y while collapsed. */}
                <div className="h-full w-full" inert={!chatMaximized}>
                    {/* Rail pane is width-0 unless maximized, so no visible fallback is needed. */}
                    <Suspense fallback={null}>
                        {/* min-w matches RAIL_MIN_WIDTH (Tailwind needs the literal). */}
                        <MountFade className="h-full w-full">
                            <SessionRail
                                activeId={activeId}
                                artifactId={artifactId}
                                addDisabled={addLocked}
                                className="h-full w-full min-w-[240px]"
                            />
                        </MountFade>
                    </Suspense>
                </div>
            </Splitter.Panel>
            <Splitter.Panel collapsible={false} className="!overflow-hidden !p-0">
                <Tabs
                    animated={false}
                    className="flex h-full min-h-0 min-w-0 w-full flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-tabpane]:h-full"
                    activeKey={activeId}
                    onChange={setActiveSession}
                    renderTabBar={() => (
                        // Kept mounted in ALL states so its height ANIMATES on transitions rather than the node
                        // mounting at full height (which snapped the content down). Collapsed to 0 in chat mode
                        // (controls live in the SessionRail) AND during onboarding (single ephemeral session);
                        // expands to 48 when the committed build view takes over — same eased height transition
                        // as the rail/config panes.
                        <div
                            className="min-w-0 shrink-0 overflow-hidden motion-safe:transition-[height] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
                            style={{height: chromeHidden || chatMaximized ? 0 : 48}}
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
                                        onRename={(id, title) => renameSession({id, title})}
                                        showSessions={!chatMaximized}
                                        extra={
                                            chatMaximized ? undefined : (
                                                <>
                                                    <SessionInspectorButton
                                                        sessionId={activeId ?? null}
                                                        artifactId={artifactId}
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
