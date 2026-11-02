import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react"

import {
    SCROLL_FADE_TOP_PX,
    clippedEdges,
    scrollEdgeMask,
    shouldRevealJump,
} from "@agenta/chat/assets"

import {useMotionPresets} from "@/lib/motion/presets"

/** Follow keeps tracking appends from this close to the bottom. Deliberately small and NOT the
 * pill's threshold: auto-scrolling someone who has scrolled up to read is the worse failure. */
const NEAR_BOTTOM_PX = 80

/** Set by `AnswerReveal` on every answer. */
export const ANSWER_ATTR = "data-answer"
/** Set by `TurnRow` on the last turn's row: "user" once a message follows the answer. */
export const LAST_TURN_ATTR = "data-last-turn"
/** Set by `TurnRow` on the last turn's row when its answer arrived after the row mounted. */
export const ARRIVED_ANSWER_ATTR = "data-arrived-answer"

/** Space above an anchored answer: clear of the top fade. */
const ANCHOR_GAP_PX = SCROLL_FADE_TOP_PX + 8

/** Past this many viewports a glide reads as slow, so the pin jumps instead. */
const GLIDE_MAX_VIEWPORTS = 2

/** Keys that scroll the transcript; one is the reader taking over. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "])

/**
 * Starts the transcript at the latest message; follows appends only while already near the bottom.
 * An answer that arrives while following is anchored at its first line, not its last, until the
 * reader's first scroll input (input, not position: browser scroll anchoring also moves scrollTop).
 */
export const useTranscriptAutoScroll = (content: unknown, sessionId?: string) => {
    const ref = useRef<HTMLDivElement | null>(null)
    // Starts true so the first content render pins to the latest message.
    const nearBottomRef = useRef(true)
    // The arrived answer that started the anchor; holding it counts as following.
    const anchorRef = useRef<string | null>(null)
    // Answers the reader took over from; never anchored again.
    const releasedRef = useRef(new Set<string>())
    // The jump pill is a SEPARATE, much further threshold (`shouldRevealJump`, shared with the
    // desktop): leaving the follow band means "stop auto-scrolling", not "offer a way back" — at
    // 80px the pill used to appear on barely a nudge.
    const [showJump, setShowJump] = useState(false)
    // The scroller's edge fades, from the same measurements: they are its scroll state, not a
    // decoration, so the first message is never dimmed while the transcript sits at its top.
    const [edgeMask, setEdgeMask] = useState("none")
    // Native smooth scroll sits outside the motion presets, so it reads their reduced-motion flag.
    const {reduced} = useMotionPresets()
    const reducedRef = useRef(reduced)
    reducedRef.current = reduced
    // The first pin of a session lands instantly; later appends glide.
    const pinnedRef = useRef(false)
    // Where a glide is heading; while set, the glide's own scroll events are not the reader leaving.
    const glideToRef = useRef<number | null>(null)

    const scrollTo = useCallback((el: HTMLDivElement, top: number) => {
        const distance = Math.abs(top - el.scrollTop)
        const glide =
            pinnedRef.current &&
            !reducedRef.current &&
            distance > 1 &&
            distance <= el.clientHeight * GLIDE_MAX_VIEWPORTS
        pinnedRef.current = true
        if (!glide) {
            glideToRef.current = null
            el.scrollTop = top
            return
        }
        glideToRef.current = top
        el.scrollTo({top, behavior: "smooth"})
    }, [])

    const measure = useCallback((el: HTMLDivElement) => {
        // A pane hidden behind the config split measures 0 everywhere; that is not the reader moving.
        if (el.clientHeight === 0) return
        const glideTo = glideToRef.current
        if (glideTo !== null && Math.abs(el.scrollTop - glideTo) <= 2) glideToRef.current = null
        nearBottomRef.current =
            glideToRef.current !== null ||
            el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
        // No pill while anchored: the reader has not scrolled away.
        const next = !nearBottomRef.current && !anchorRef.current && shouldRevealJump(el)
        setShowJump((prev) => (prev === next ? prev : next))
        const edges = clippedEdges(el)
        const mask = scrollEdgeMask(edges.top, edges.bottom)
        setEdgeMask((prev) => (prev === mask ? prev : mask))
    }, [])

    /** Pin while following: to the bottom, but never past the top of an answer that just arrived. */
    const follow = useCallback(
        (el: HTMLDivElement) => {
            if (!nearBottomRef.current && !anchorRef.current) return
            if (!anchorRef.current) {
                const key = el
                    .querySelector(`[${ARRIVED_ANSWER_ATTR}]`)
                    ?.getAttribute(ARRIVED_ANSWER_ATTR)
                if (key && !releasedRef.current.has(key)) anchorRef.current = key
            }
            // The last answer, not the marker: post-run adoption can remount the turn under a new id.
            const answer = anchorRef.current
                ? el.querySelector<HTMLElement>(`[${LAST_TURN_ATTR}] [${ANSWER_ATTR}]`)
                : null
            if (!answer) {
                const held = anchorRef.current
                // Answer briefly out of the DOM (transcript re-adoption, a resumed run): hold still.
                if (held && !el.querySelector(`[${LAST_TURN_ATTR}="user"]`)) return
                // A message sent after the answer ends the anchor.
                if (held) releasedRef.current.add(held)
                anchorRef.current = null
                scrollTo(el, el.scrollHeight - el.clientHeight)
                return
            }
            const answerTop =
                answer.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
            const bottom = el.scrollHeight - el.clientHeight
            scrollTo(el, Math.max(0, Math.min(bottom, answerTop - ANCHOR_GAP_PX)))
        },
        [scrollTo],
    )

    // Also releases an arrived answer never anchored, so scrolling back down does not snap to it.
    const release = useCallback(() => {
        const el = ref.current
        const arrived = el
            ?.querySelector(`[${ARRIVED_ANSWER_ATTR}]`)
            ?.getAttribute(ARRIVED_ANSWER_ATTR)
        if (arrived) releasedRef.current.add(arrived)
        if (anchorRef.current) releasedRef.current.add(anchorRef.current)
        anchorRef.current = null
        glideToRef.current = null
    }, [])

    const onScroll = useCallback(() => {
        const el = ref.current
        if (el) measure(el)
    }, [measure])

    const jumpToLatest = useCallback(() => {
        const el = ref.current
        if (!el) return
        release()
        nearBottomRef.current = true
        setShowJump(false)
        scrollTo(el, el.scrollHeight - el.clientHeight)
    }, [release, scrollTo])

    // A screen kept mounted across a session switch must not carry the last session's position.
    const sessionRef = useRef(sessionId)
    useLayoutEffect(() => {
        if (sessionRef.current === sessionId) return
        sessionRef.current = sessionId
        nearBottomRef.current = true
        anchorRef.current = null
        pinnedRef.current = false
        glideToRef.current = null
    }, [sessionId])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        // Pinned: land on the newest turn first, then read the edges from where that left us.
        // Parked mid-scroll: streamed growth moves the newest turn further away without firing a
        // scroll event, so re-measure on content instead of waiting for a gesture that never comes.
        follow(el)
        measure(el)
    }, [content, follow, measure])

    // The pin above measures at layout time, but a transcript keeps growing after that — a fence
    // finishes highlighting, an image loads, a tool card lays itself out. Without this the opening
    // pin lands on a fraction of the final height and a long chat reads as starting at the top.
    // Follow growth at the bottom; parked mid-scroll, re-measure (a shrink clamps without a scroll event).
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            if (el.clientHeight === 0) return
            follow(el)
            measure(el)
        })
        observer.observe(el)
        for (const child of Array.from(el.children)) observer.observe(child)
        return () => observer.disconnect()
    }, [content, follow, measure])

    // The reader's own scroll input ends an anchor. Listened on the scroller, so a tap in the
    // composer or a key typed there never counts.
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const onKey = (event: KeyboardEvent) => {
            if (SCROLL_KEYS.has(event.key)) release()
        }
        el.addEventListener("wheel", release, {passive: true})
        el.addEventListener("touchmove", release, {passive: true})
        el.addEventListener("pointerdown", release, {passive: true})
        el.addEventListener("keydown", onKey)
        // A glide that stopped short (the content shrank under it) is over.
        const onScrollEnd = () => {
            glideToRef.current = null
            measure(el)
        }
        el.addEventListener("scrollend", onScrollEnd)
        return () => {
            el.removeEventListener("scrollend", onScrollEnd)
            el.removeEventListener("wheel", release)
            el.removeEventListener("touchmove", release)
            el.removeEventListener("pointerdown", release)
            el.removeEventListener("keydown", onKey)
        }
    }, [content, measure, release])

    return {ref, onScroll, jumpToLatest, showJump, edgeMask}
}
