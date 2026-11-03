import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react"

import {shouldRevealJump} from "@agenta/chat/assets"
import {type ChatStatus, type UIMessage} from "ai"

import {CONTENT_VISIBILITY_ENABLED} from "../assets/conversationLayout"

import {type ScrollIntent} from "./useScrollIntent"

/**
 * SC-1…4 scroll engineering for the plain (non-virtualized) transcript: submit/restore pins,
 * stick-to-bottom, anchor-based preservation on resize, and the jump-to-latest pill. Owns the
 * scroll container ref and every DOM measurement; reads/writes what to do next through the shared
 * `intent`. Inert while Virtuoso is on — it owns measurement and anchoring itself.
 */
export const useTranscriptScroll = ({
    intent,
    messages,
    status,
    useVirtuoso,
}: {
    intent: ScrollIntent
    messages: UIMessage[]
    status: ChatStatus
    useVirtuoso: boolean
}) => {
    const {stickRef, armBottomRef, animateBottomRef, programmaticScrollRef, setShowJump} = intent
    // The container is conditionally rendered (Virtuoso replaces it, and an empty conversation
    // renders it even under Virtuoso), so it can unmount and remount within one session. The ref is
    // for synchronous reads inside handlers; the STATE is what effects that bind listeners to the
    // node key on — otherwise they'd stay attached to a node that has since been detached.
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null)
    const attachScroll = useCallback((el: HTMLDivElement | null) => {
        scrollRef.current = el
        setScrollNode(el)
    }, [])
    // Teardown for the in-flight smooth scroll (removes its listeners + fallback timer).
    const pinCleanupRef = useRef<(() => void) | null>(null)
    // Last observed scrollTop. A content shrink (tool gutter collapsing, reasoning folding) clamps
    // scrollTop to the new smaller bottom and fires a scroll event that isn't a user gesture; comparing
    // against this lets onScroll tell a real scroll-DOWN-to-edge from that clamp (which only decreases).
    const lastScrollTopRef = useRef(0)
    // rAF handle coalescing the jump-pill measurement (querySelectorAll + getBoundingClientRect) to once
    // per frame — a fast wheel/drag and every streamed render would otherwise re-measure a dirtied layout.
    const showJumpRafRef = useRef(0)
    // Newest turn id, in a ref so the pill measurement can read it from listeners bound once.
    const newestIdRef = useRef<string | undefined>(undefined)
    newestIdRef.current = messages[messages.length - 1]?.id

    // ── SC-3: anchor-based scroll preservation ──
    // We do scroll-anchoring ourselves (Safari has no CSS overflow-anchor, and it would fight our
    // programmatic pins). While NOT following, remember the topmost visible message; when content above
    // it changes height (an image loads, markdown/code renders, a tool card expands), we compensate
    // scrollTop so that message stays on the same line. Growth BELOW the anchor (the streaming answer)
    // doesn't move it, so it's left alone.
    const anchorRef = useRef<{id: string; top: number} | null>(null)
    const recordAnchor = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const containerTop = el.getBoundingClientRect().top
        for (const w of el.querySelectorAll<HTMLElement>("[data-mid]")) {
            const r = w.getBoundingClientRect()
            // First message whose bottom is still below the viewport top = the topmost visible one.
            if (r.bottom > containerTop + 1) {
                anchorRef.current = {id: w.dataset.mid ?? "", top: r.top - containerTop}
                return
            }
        }
        anchorRef.current = null
    }, [])

    // Everything above is measured AGAINST a specific container, so a node swap invalidates all of
    // it: the scroll baseline (a stale one makes the first scroll-down-to-edge on the new node fail
    // `scrollTop > prevTop`, so follow doesn't re-arm), the SC-3 anchor (its offset was taken in the
    // old node's coordinate space), and any glide still animating the node that just went away.
    // Runs before the SC-1/SC-2 pin below, which is declared later.
    useLayoutEffect(() => {
        pinCleanupRef.current?.()
        // Cancelling skips the pin's settle, which is what normally releases the guard. `intent`
        // outlives this hook, so a leaked `true` would keep follow/anchoring off after a remount.
        programmaticScrollRef.current = false
        anchorRef.current = null
        lastScrollTopRef.current = scrollNode?.scrollTop ?? 0
    }, [scrollNode])

    // ── DT4 autoscroll: stick to the bottom of the scrollable area while following ──
    // The fill (min-h-full turn group) makes "question at top" the scroll bottom for a short answer
    // and the answer's end the bottom for a long one, so scrollHeight is the right target (+ pb-6 gap).
    // Only writes when not already pinned: the ResizeObserver (below) and the follow effect both pin on
    // the same streamed growth, so the guard drops the redundant write (and the scroll event it fires).
    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const target = el.scrollHeight - el.clientHeight
        if (el.scrollTop < target - 0.5) el.scrollTop = target
    }, [])

    // Recompute jump-pill visibility, coalesced to one rAF per frame. The measurement
    // (shouldRevealJump → querySelectorAll + getBoundingClientRect) is display-only, so a one-frame
    // lag is invisible; the correctness-critical follow decision (stickRef) and the SC-3 anchor stay
    // synchronous in onScroll.
    const scheduleShowJump = useCallback(() => {
        // Cancel-and-reschedule, never early-return: a hidden tab skips the frame, and an early
        // return would latch the handle non-zero and kill the pill for the life of the mount.
        if (showJumpRafRef.current) cancelAnimationFrame(showJumpRafRef.current)
        showJumpRafRef.current = requestAnimationFrame(() => {
            showJumpRafRef.current = 0
            const el = scrollRef.current
            if (!el) return
            setShowJump(!stickRef.current && shouldRevealJump(el, newestIdRef.current))
        })
    }, [])

    // Smoothly scroll the log to `target` (the SC-1 pin / jump-to-latest). Uses the browser's NATIVE
    // smooth scroll so it runs on the compositor — smooth even while React re-renders streamed tokens,
    // and natively interruptible. The caller holds programmaticScrollRef across it so onScroll / the
    // ResizeObserver ignore the in-between frames; `scrollend` (or a fallback timeout) settles it. A
    // real user wheel/touch hands control straight back. Honors prefers-reduced-motion (instant).
    const animatePinTo = useCallback((el: HTMLDivElement, target: number, onSettle: () => void) => {
        pinCleanupRef.current?.()
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce || Math.abs(target - el.scrollTop) < 2) {
            el.scrollTop = target
            onSettle()
            return
        }
        let done = false
        let timer = 0
        const cleanup = () => {
            el.removeEventListener("scrollend", onEnd)
            el.removeEventListener("wheel", onUser)
            el.removeEventListener("touchstart", onUser)
            if (timer) clearTimeout(timer)
            pinCleanupRef.current = null
        }
        // Reached the target (scrollend, or the fallback timer) → settle: recordAnchor + release guard.
        const onEnd = () => {
            if (done) return
            done = true
            cleanup()
            onSettle()
        }
        // User grabbed the scroll mid-glide → stop guarding so their scroll is honored; don't settle.
        const onUser = () => {
            if (done) return
            done = true
            cleanup()
            programmaticScrollRef.current = false
        }
        el.addEventListener("scrollend", onEnd)
        el.addEventListener("wheel", onUser, {passive: true})
        el.addEventListener("touchstart", onUser, {passive: true})
        timer = window.setTimeout(onEnd, 700) // fallback where scrollend is unsupported (older Safari)
        // Cancel without settling (a newer pin supersedes this one, or we unmount).
        pinCleanupRef.current = () => {
            done = true
            cleanup()
        }
        el.scrollTo({top: target, behavior: "smooth"})
    }, [])

    // Stop any in-flight pin animation on unmount (tab close / revision swap).
    useEffect(
        () => () => {
            pinCleanupRef.current?.()
            programmaticScrollRef.current = false
            if (showJumpRafRef.current) cancelAnimationFrame(showJumpRafRef.current)
        },
        [],
    )

    useEffect(() => {
        if (useVirtuoso) return
        // Don't instant-jump while a programmatic glide (SC-1 submit / jump-to-latest) owns the
        // scroll — that snap would override the animation. The glide's own settle re-pins to bottom.
        if (stickRef.current && !programmaticScrollRef.current) scrollToBottom()
    }, [messages, status, scrollToBottom, useVirtuoso])

    const onScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        // Track scrollTop even for our own pins (recorded, then ignored) so the next real event has an
        // accurate baseline to compare against.
        const prevTop = lastScrollTopRef.current
        lastScrollTopRef.current = el.scrollTop
        // Ignore the scroll event our own pin produced — only a real user scroll changes follow state.
        if (programmaticScrollRef.current) return
        // Follow ONLY when at the very bottom of the scrollable area; a partial scroll must not enable
        // it (that was the yank). Re-arm follow ONLY when the user actively scrolls DOWN to the edge (or
        // is already following): a content shrink (tool gutter collapsing to "Used N tools", reasoning
        // folding) clamps scrollTop to the new smaller bottom and fires a scroll event, but a clamp only
        // ever DECREASES scrollTop, so `> prevTop` rejects it — otherwise the next token would snap the
        // min-h-full active turn to the top (reported as the chat "jumping to the top" mid-stream).
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        stickRef.current = atBottom && (stickRef.current || el.scrollTop > prevTop)
        // Anchor is correctness-critical for SC-3 (the RO reads it next resize) → capture synchronously.
        if (!stickRef.current) recordAnchor()
        // Pill is display-only → coalesce its costly measurement to one rAF/frame.
        scheduleShowJump()
    }, [recordAnchor, scheduleShowJump])

    const jumpToLatest = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        setShowJump(false)
        // Glide to the bottom like the SC-1 pin. Resume follow (stickRef) only ON SETTLE — flipping
        // it true now would let the per-token follow effect jam to the bottom mid-glide. The final
        // scrollToBottom catches any content that streamed in during the animation.
        programmaticScrollRef.current = true
        animatePinTo(el, el.scrollHeight, () => {
            el.scrollTop = el.scrollHeight
            stickRef.current = true
            programmaticScrollRef.current = false
        })
    }, [animatePinTo])

    // SC-3: when any message resizes (image load, markdown/code render, tool-card expand), hold the
    // reader's place. Following → keep pinned to the bottom; otherwise compensate scrollTop so the
    // anchored (topmost visible) message stays on the same line. Guarded so it never fights our own
    // pins. Re-subscribed when the message set changes (a part growing fires on the same wrapper).
    useEffect(() => {
        if (useVirtuoso) return
        const el = scrollNode
        if (!el) return
        const onResize = (entries: ResizeObserverEntry[]) => {
            // Pin each rendered row's REAL height as its own `content-visibility` placeholder, so it
            // keeps the exact same box when it later scrolls off-screen. Only meaningful while
            // content-visibility is enabled — otherwise `containIntrinsicSize` is inert, so skip the
            // whole measurement to avoid a getBoundingClientRect + style write per row on every resize.
            if (CONTENT_VISIBILITY_ENABLED) {
                for (const e of entries) {
                    const node = e.target as HTMLElement
                    if (node === el) continue // the viewport itself is not a row — never pin it
                    const check = node.checkVisibility as
                        | ((o?: {contentVisibilityAuto?: boolean}) => boolean)
                        | undefined
                    if (check && !check.call(node, {contentVisibilityAuto: true})) continue
                    const h = Math.round(node.getBoundingClientRect().height)
                    if (h > 0) node.style.containIntrinsicSize = `auto ${h}px`
                }
            }
            if (programmaticScrollRef.current) return
            if (stickRef.current) {
                scrollToBottom() // guarded: no-op if the follow effect already pinned this growth
                return
            }
            const a = anchorRef.current
            if (!a) return
            let node: HTMLElement | null = null
            try {
                node = el.querySelector<HTMLElement>(`[data-mid="${a.id}"]`)
            } catch {
                node = null
            }
            if (!node) return
            const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top
            // A stale anchor (its node scrolled far off after a programmatic jump / follow) yields an
            // implausible delta; applying it would slam the scroll to the top. Drop it and let the next
            // scroll / pointer-down re-anchor. A real collapse/expand moves the anchor well under a viewport.
            if (Math.abs(delta) > el.clientHeight) {
                anchorRef.current = null
                return
            }
            if (Math.abs(delta) > 0.5) {
                programmaticScrollRef.current = true
                el.scrollTop += delta
                requestAnimationFrame(() => {
                    programmaticScrollRef.current = false
                })
            }
        }
        const ro = new ResizeObserver(onResize)
        // Observe the VIEWPORT too: the lazy composer/session-bar regions outside it hydrate a
        // beat after mount and change this element's clientHeight — rows alone don't resize then,
        // so without this the clamp shifts the view (following → re-pin; reading → hold anchor).
        ro.observe(el)
        el.querySelectorAll("[data-mid]").forEach((w) => ro.observe(w))
        return () => ro.disconnect()
    }, [messages.length, scrollToBottom, useVirtuoso, scrollNode])

    // SC-1 (submit) / SC-2 (restore): scroll the log to the bottom, once, when armed. With the active
    // turn reserving a viewport (min-h-full + top padding to clear the fade), "bottom" shows the new
    // question pinned at the top and the answer streaming into the space below — no per-element pin to
    // compute, nothing to keep re-aligning as content arrives. A fresh submit glides; a restore jumps.
    // Follow (stickRef) resumes only ON SETTLE so the per-token follow effect can't jam mid-glide.
    useLayoutEffect(() => {
        if (useVirtuoso) return
        if (!armBottomRef.current) return
        const el = scrollRef.current
        if (!el) return
        armBottomRef.current = false
        programmaticScrollRef.current = true
        const settle = () => {
            el.scrollTop = el.scrollHeight // catch anything that streamed in during the glide
            stickRef.current = true
            programmaticScrollRef.current = false
        }
        if (animateBottomRef.current) {
            animateBottomRef.current = false
            animatePinTo(el, el.scrollHeight, settle)
        } else {
            el.scrollTop = el.scrollHeight
            requestAnimationFrame(settle)
        }
    }, [messages, animatePinTo, useVirtuoso])

    // Keep the jump pill honest as content streams/settles: show it when the real latest message is
    // below the fold (e.g. a long answer growing past the viewport while parked at the top), and hide
    // it once that message is visible or while we're following. Coalesced (not a sync layout read per
    // streamed render) — the pill is display-only, so one frame of lag is imperceptible.
    useEffect(() => {
        if (useVirtuoso) return
        scheduleShowJump()
    }, [messages, status, scheduleShowJump, useVirtuoso])

    // A hidden tab runs no rAF, so re-measure on return or the pill keeps its stale state.
    useEffect(() => {
        if (useVirtuoso) return
        const onVisible = () => {
            if (document.visibilityState === "visible") scheduleShowJump()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => document.removeEventListener("visibilitychange", onVisible)
    }, [scheduleShowJump, useVirtuoso])

    // SC-4: interaction is intent, not just scrolling. While following, a real text selection inside
    // the transcript — or opening a link in it — means the reader is engaging here, so release follow
    // (exactly like a scroll). New content keeps arriving offscreen and the jump pill offers the way
    // back. Keyboard / wheel / touch already release because they scroll (onScroll). The composer is
    // exempt: its selections and links aren't inside the log, so `el.contains(...)` ignores them.
    // Keyed on the NODE, not on mount: the container remounts when the engine changes, and a
    // mount-only binding would keep listening on the detached one for the rest of the session.
    useEffect(() => {
        const el = scrollNode
        if (!el) return
        const release = () => {
            if (!stickRef.current) return
            stickRef.current = false
            setShowJump(shouldRevealJump(el, newestIdRef.current))
        }
        const onSelectionChange = () => {
            if (!stickRef.current) return
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
            if (sel.anchorNode && el.contains(sel.anchorNode)) release()
        }
        const onClick = (e: MouseEvent) => {
            if ((e.target as HTMLElement | null)?.closest("a")) release()
        }
        document.addEventListener("selectionchange", onSelectionChange)
        el.addEventListener("click", onClick)
        return () => {
            document.removeEventListener("selectionchange", onSelectionChange)
            el.removeEventListener("click", onClick)
        }
    }, [scrollNode])

    // `attachScroll` is the ONLY way in: handing out `scrollRef` too would let a caller attach the
    // node without the state ever knowing, which is the split this hook exists to close.
    return {attachScroll, onScroll, recordAnchor, jumpToLatest}
}
