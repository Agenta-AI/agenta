/**
 * Watches for a text selection inside a `[data-quotable]` body under `rootRef` and turns it into a
 * quote candidate: the excerpt, where it came from, and a live rect to anchor the pill on.
 *
 * `selectionchange` fires on every caret move and continuously through a drag-select, so the
 * handler early-exits on a collapsed selection BEFORE it touches the DOM, and everything past that
 * is coalesced into one rAF. With the feature flag down nothing is bound at all.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {normalizeQuoteText, type QuoteSource} from "@agenta/shared/quotes"

import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {getQuoteSource} from "./sources"

export interface QuoteCandidate {
    text: string
    source: QuoteSource
    /** Raw source text of the body the selection landed in, for line resolution. */
    sourceText?: string
    /** Root-relative box of the selection, recomputed as the pane scrolls. */
    rect: {top: number; left: number; bottom: number; width: number}
    range: Range
}

/** A phone's own selection callout needs a beat to settle before we draw over it. */
const TOUCH_SETTLE_MS = 260

const readTarget = (node: Node | null): HTMLElement | null => {
    const el = node instanceof Element ? node : node?.parentElement
    return (el?.closest("[data-quotable]") as HTMLElement | null) ?? null
}

const sourceFrom = (el: HTMLElement): QuoteSource | null => {
    const kind = el.dataset.quoteKind
    if (kind === "message") {
        const messageId = el.dataset.quoteMessageId
        if (!messageId) return null
        return {kind: "message", messageId, turnLabel: el.dataset.quoteLabel || "Agent reply"}
    }
    if (kind === "file") {
        const path = el.dataset.quotePath
        if (!path) return null
        const displayPath = el.dataset.quoteDisplayPath || path
        return {
            kind: "file",
            path,
            displayPath,
            fileName: displayPath.split("/").pop() || displayPath,
        }
    }
    return null
}

const rectIn = (root: HTMLElement, range: Range): QuoteCandidate["rect"] | null => {
    const box = range.getBoundingClientRect()
    // A row parked offscreen under `content-visibility:auto` measures as zero — never anchor to it.
    if (box.width === 0 && box.height === 0) return null
    const rootBox = root.getBoundingClientRect()
    return {
        top: box.top - rootBox.top,
        left: box.left - rootBox.left + box.width / 2,
        bottom: box.bottom - rootBox.top,
        width: box.width,
    }
}

export const useQuoteSelection = ({
    rootRef,
    enabled,
    onReply,
}: {
    rootRef: React.RefObject<HTMLElement | null>
    enabled: boolean
    /** ⌥Q and the pill's Reply both land here. */
    onReply: (candidate: QuoteCandidate) => void
}) => {
    const [candidate, setCandidate] = useState<QuoteCandidate | null>(null)
    const candidateRef = useRef<QuoteCandidate | null>(null)
    candidateRef.current = candidate

    const dismiss = useCallback(() => setCandidate(null), [])

    useEffect(() => {
        if (!enabled) return
        let frame = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        const coarse = hasCoarsePointer()

        const evaluate = () => {
            const root = rootRef.current
            const selection = window.getSelection()
            // The cheapest possible exit, and the one that runs on every caret move.
            if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
                setCandidate(null)
                return
            }
            const range = selection.getRangeAt(0)
            // The note box holds its own textarea; selecting inside it must not re-arm the pill.
            if (readTarget(range.commonAncestorContainer)?.dataset.quoteIgnore === "true") return
            const target = readTarget(range.commonAncestorContainer)
            if (!target || !root.contains(target)) {
                setCandidate(null)
                return
            }
            const text = normalizeQuoteText(selection.toString())
            const source = sourceFrom(target)
            if (!text || !source) {
                setCandidate(null)
                return
            }
            const rect = rectIn(root, range)
            if (!rect) {
                setCandidate(null)
                return
            }
            const key = target.dataset.quoteSource
            setCandidate({
                text,
                source,
                sourceText: key ? getQuoteSource(key) : undefined,
                rect,
                range: range.cloneRange(),
            })
        }

        const schedule = () => {
            const selection = window.getSelection()
            // Early-exit before any DOM work — this is the hot path during a drag-select.
            if (!selection || selection.isCollapsed) {
                if (candidateRef.current) setCandidate(null)
                return
            }
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(evaluate)
        }

        /** Touch reports its selection before the native callout lands; wait it out, then measure. */
        const scheduleSettled = () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(schedule, coarse ? TOUCH_SETTLE_MS : 0)
        }

        const reposition = () => {
            const held = candidateRef.current
            const root = rootRef.current
            if (!held || !root) return
            const rect = rectIn(root, held.range)
            setCandidate(rect ? {...held, rect} : null)
        }

        const onKeyDown = (e: KeyboardEvent) => {
            const held = candidateRef.current
            if (!held) return
            if (
                e.altKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.shiftKey &&
                !e.repeat &&
                e.code === "KeyQ"
            ) {
                e.preventDefault()
                onReply(held)
                setCandidate(null)
            }
        }

        document.addEventListener("selectionchange", schedule)
        document.addEventListener("mouseup", scheduleSettled)
        document.addEventListener("keyup", schedule)
        document.addEventListener("touchend", scheduleSettled)
        document.addEventListener("keydown", onKeyDown)
        window.addEventListener("resize", reposition)
        // Capture: the scroller is a descendant of the root, and scroll does not bubble.
        document.addEventListener("scroll", reposition, true)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            if (timer) clearTimeout(timer)
            document.removeEventListener("selectionchange", schedule)
            document.removeEventListener("mouseup", scheduleSettled)
            document.removeEventListener("keyup", schedule)
            document.removeEventListener("touchend", scheduleSettled)
            document.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("resize", reposition)
            document.removeEventListener("scroll", reposition, true)
        }
    }, [enabled, rootRef, onReply])

    return {candidate, dismiss}
}
