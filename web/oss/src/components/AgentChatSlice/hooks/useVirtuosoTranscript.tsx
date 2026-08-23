import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {type ChatStatus, type UIMessage} from "ai"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {type Components, type VirtuosoHandle} from "react-virtuoso"

import {virtStateBySession} from "../state/sessionEphemera"
import {
    agentChatItemEstimateAtom,
    agentChatOverscanAtom,
    agentChatVirtualizeAtom,
    isAgentChatVirtualizationAvailable,
} from "../state/virtualization"

import {type ScrollIntent} from "./useScrollIntent"

/** SPIKE(virtuoso): context passed to the Virtuoso Header/Footer slots (top padding + active turn). */
export interface VirtCtx {
    header: React.ReactNode
    footer: React.ReactNode
}

/**
 * SPIKE(react-virtuoso): windowing variant of the transcript, evaluated against content-visibility.
 * Owns the Virtuoso handle, the per-session scroll snapshot, the manual follow (Virtuoso's
 * `followOutput` can't see the Footer-hosted active turn), and the explicit viewport reserve that
 * replaces `min-h-full`. `enabled` gates BOTH this wiring and `useTranscriptScroll` — exactly one
 * engine owns the scroll at a time.
 */
export const useVirtuosoTranscript = ({
    intent,
    sessionId,
    messages,
    status,
}: {
    intent: ScrollIntent
    sessionId: string
    messages: UIMessage[]
    status: ChatStatus
}) => {
    const {armBottomRef, animateBottomRef, setShowJump} = intent
    // Controlled live from the playground settings dropdown (Virtualization section). When on, the
    // SC-1..4 scroll effects are disabled (Virtuoso owns measurement/anchoring) and the transcript
    // renders via <Virtuoso>; overscan / row-estimate are tunable there too.
    // Virtualize only when the env flag is present AND it's enabled in the settings — no other gates.
    const virtEnabledInSettings = useAtomValue(agentChatVirtualizeAtom)
    const useVirtuoso = isAgentChatVirtualizationAvailable() && virtEnabledInSettings
    const virtOverscan = useAtomValue(agentChatOverscanAtom)
    const virtItemEstimate = useAtomValue(agentChatItemEstimateAtom)
    const virtuosoRef = useRef<VirtuosoHandle>(null)
    // Snapshot captured by a previous mount of this session (route re-entry). Read once at
    // mount — `restoreStateFrom` is a mount-time-only Virtuoso prop.
    const [virtRestoreState] = useState(() =>
        useVirtuoso ? virtStateBySession.get(sessionId) : undefined,
    )
    const router = useRouter()
    useEffect(() => {
        if (!useVirtuoso) return
        const capture = () => {
            // getState is synchronous; guard the handle for the unmount-cleanup path.
            virtuosoRef.current?.getState((snapshot) => {
                virtStateBySession.set(sessionId, snapshot)
            })
        }
        // routeChangeStart fires while the transcript is still mounted and measured — the
        // reliable capture point. The cleanup capture is best-effort (the handle may already
        // be detached there), covering non-route unmounts like a revision-type swap.
        router.events.on("routeChangeStart", capture)
        return () => {
            router.events.off("routeChangeStart", capture)
            capture()
        }
    }, [useVirtuoso, sessionId, router])

    // ── SPIKE(virtuoso) scroll wiring (only active when the flag is on) ──
    // Follow = stick to the bottom. Virtuoso's `followOutput` fires on item-count changes only, but the
    // active turn streams inside the Footer (not an item), so drive stick manually on each update.
    const virtFollowRef = useRef(true)
    // While true (a short window after a submit), the follow tracks the bottom SMOOTHLY — so the sent
    // question glides to the top and the streaming answer is tracked continuously (each token retargets
    // the in-flight smooth scroll). Otherwise it snaps instantly to keep up with fast streaming.
    const virtSmoothRef = useRef(false)
    const virtSmoothTimerRef = useRef(0)
    useEffect(() => {
        if (!useVirtuoso || !virtFollowRef.current) return
        const behavior: ScrollBehavior = virtSmoothRef.current ? "smooth" : "auto"
        const id = requestAnimationFrame(() => virtuosoRef.current?.scrollTo({top: 1e9, behavior}))
        return () => cancelAnimationFrame(id)
    }, [messages, status, useVirtuoso])
    // SC-1 reserve for the virtuoso path: `min-h-full` doesn't work inside Virtuoso's Footer (100%
    // resolves against its content-sized list, not the viewport), so measure the scroller's height and
    // reserve it explicitly on the active-turn Footer — that's what lets a sent question pin to the top.
    const virtRoRef = useRef<ResizeObserver | null>(null)
    const [virtViewportH, setVirtViewportH] = useState(0)
    // One-shot restore clamp: `restoreStateFrom` puts back the PREVIOUS scrollTop verbatim, so a
    // session that was left with its last message hugging the bottom edge restores exactly there —
    // and any end-of-conversation clearance added below is off-screen by construction. If the
    // restored position is near the end, settle to TRUE bottom so the clearance is actually shown.
    const restoreClampedRef = useRef(false)
    const setVirtScroller = useCallback((el: HTMLElement | Window | null) => {
        virtRoRef.current?.disconnect()
        const node = el instanceof HTMLElement ? el : null
        if (!node) return
        setVirtViewportH(node.clientHeight)
        const ro = new ResizeObserver(() => setVirtViewportH(node.clientHeight))
        ro.observe(node)
        virtRoRef.current = ro
        if (!restoreClampedRef.current) {
            restoreClampedRef.current = true
            // Two frames: let Virtuoso apply the restored state / first measurement first.
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    const gap = node.scrollHeight - node.scrollTop - node.clientHeight
                    if (gap > 0 && gap < 320) {
                        virtuosoRef.current?.scrollTo({top: 1e9, behavior: "auto"})
                    }
                }),
            )
        }
    }, [])
    useEffect(
        () => () => {
            virtRoRef.current?.disconnect()
            window.clearTimeout(virtSmoothTimerRef.current)
        },
        [],
    )
    // SC-1/2 equivalent: on submit/restore (armBottomRef), re-arm follow to the bottom once Virtuoso has
    // mounted + measured (question-at-top emerges from the Footer's viewport reserve). A submit tracks
    // smoothly for a short window; a restore snaps. The follow effect above does the per-token scrolling.
    useLayoutEffect(() => {
        if (!useVirtuoso || !armBottomRef.current) return
        const animate = animateBottomRef.current
        armBottomRef.current = false
        animateBottomRef.current = false
        virtFollowRef.current = true
        setShowJump(false)
        virtSmoothRef.current = animate
        window.clearTimeout(virtSmoothTimerRef.current)
        if (animate) {
            virtSmoothTimerRef.current = window.setTimeout(() => {
                virtSmoothRef.current = false
            }, 600)
        }
        requestAnimationFrame(() =>
            requestAnimationFrame(() =>
                virtuosoRef.current?.scrollTo({top: 1e9, behavior: animate ? "smooth" : "auto"}),
            ),
        )
    }, [messages, useVirtuoso])
    const virtJumpToLatest = useCallback(() => {
        virtFollowRef.current = true
        setShowJump(false)
        virtuosoRef.current?.scrollTo({top: 1e9, behavior: "smooth"})
    }, [])
    // Virtuoso's own edge detection is the follow signal here (the manual effect above only acts
    // while following), and it doubles as the pill's visibility.
    const onAtBottomStateChange = useCallback((atBottom: boolean) => {
        virtFollowRef.current = atBottom
        setShowJump(!atBottom)
    }, [])
    // Stable component identities (Virtuoso remounts these if their identity changes). They read live
    // content from `context`, which we pass fresh each render — so they re-render without remounting.
    const virtComponents = useMemo<Components<UIMessage, VirtCtx>>(
        () => ({
            Header: ({context}) => <>{context?.header ?? null}</>,
            Footer: ({context}) => <>{context?.footer ?? null}</>,
        }),
        [],
    )

    return {
        enabled: useVirtuoso,
        virtuosoRef,
        restoreState: virtRestoreState,
        overscan: virtOverscan,
        itemEstimate: virtItemEstimate,
        viewportH: virtViewportH,
        setScroller: setVirtScroller,
        components: virtComponents,
        jumpToLatest: virtJumpToLatest,
        onAtBottomStateChange,
    }
}
