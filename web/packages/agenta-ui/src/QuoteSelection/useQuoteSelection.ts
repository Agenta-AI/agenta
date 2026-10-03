// Turns a selection inside a `[data-quotable]` body into a quote candidate, offered on release.
import {useCallback, useEffect, useRef, useState} from "react"

import {
    stripQuoteWhitespace,
    tidyQuoteText,
    type QuoteSource,
    type RenderedSelection,
} from "@agenta/shared/quotes"

import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {getQuoteSource} from "./sources"

export interface QuoteCandidate {
    text: string
    source: QuoteSource
    /** Raw source text of the body the selection landed in, for line resolution. */
    sourceText?: string
    /** The `[data-quotable]` body the selection landed in. */
    target: HTMLElement
    /** Root-relative box of the selection, recomputed as the pane scrolls. */
    rect: {top: number; left: number; bottom: number; width: number}
    range: Range
}

/** Lets a phone's native selection callout settle before the pill draws over it. */
const TOUCH_SETTLE_MS = 260

const elementOf = (node: Node | null): Element | null =>
    node instanceof Element ? node : (node?.parentElement ?? null)

const readTarget = (node: Node | null): HTMLElement | null =>
    (elementOf(node)?.closest("[data-quotable]") as HTMLElement | null) ?? null

/** The pill and note box: selecting or pressing inside them must not re-arm or dismiss. */
const isOwnUi = (node: Node | null): boolean =>
    Boolean(elementOf(node)?.closest("[data-quote-ignore]"))

/**
 * The selection's place in the body's rendered text, whitespace dropped (see `locateQuote`).
 * Read once, on Reply: it walks every text node of the body.
 */
export const renderedSelection = (target: HTMLElement, range: Range): RenderedSelection => {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (isOwnUi(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    const before: string[] = []
    const rendered: string[] = []
    let reached = false
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data
        rendered.push(data)
        if (reached) continue
        if (node === range.startContainer) {
            before.push(data.slice(0, range.startOffset))
            reached = true
        } else if (range.comparePoint(node, data.length) < 0) {
            before.push(data)
        } else {
            reached = true
        }
    }
    return {
        before: stripQuoteWhitespace(before.join("")),
        rendered: stripQuoteWhitespace(rendered.join("")),
    }
}

const sourceFrom = (el: HTMLElement): QuoteSource | null => {
    const kind = el.dataset.quoteKind
    if (kind === "message") {
        const messageId = el.dataset.quoteMessageId
        if (!messageId) return null
        return {kind: "message", messageId}
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
            mountId: el.dataset.quoteMount || undefined,
        }
    }
    return null
}

export const rectIn = (root: HTMLElement, range: Range): QuoteCandidate["rect"] | null => {
    const box = range.getBoundingClientRect()
    // An offscreen `content-visibility:auto` row measures as zero; never anchor to it.
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
        let dragging = false
        const coarse = hasCoarsePointer()

        const evaluate = () => {
            const root = rootRef.current
            const selection = window.getSelection()
            if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
                setCandidate(null)
                return
            }
            const range = selection.getRangeAt(0)
            if (isOwnUi(range.commonAncestorContainer)) return
            const target = readTarget(range.commonAncestorContainer)
            if (!target || !root.contains(target)) {
                setCandidate(null)
                return
            }
            // Line breaks stay: code, YAML and tables must reach the agent line by line.
            const text = tidyQuoteText(selection.toString())
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
                target,
                rect,
                range: range.cloneRange(),
            })
        }

        const schedule = () => {
            // Mid-drag the pill would land under the cursor and cut the selection short.
            if (dragging) return
            const selection = window.getSelection()
            if (!selection || selection.isCollapsed) {
                if (candidateRef.current) setCandidate(null)
                return
            }
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(evaluate)
        }

        // An outside press closes the pill and its selection; left up, the release re-offers it.
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0 || isOwnUi(e.target as Node)) return
            dragging = true
            if (candidateRef.current) {
                setCandidate(null)
                window.getSelection()?.removeAllRanges()
            }
        }

        const onPointerUp = () => {
            if (!dragging) return
            dragging = false
            scheduleSettled()
        }

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
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("pointerup", onPointerUp, true)
        document.addEventListener("pointercancel", onPointerUp, true)
        document.addEventListener("keyup", schedule)
        document.addEventListener("keydown", onKeyDown)
        window.addEventListener("resize", reposition)
        // Capture: scroll does not bubble up from the pane's scroller.
        document.addEventListener("scroll", reposition, true)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            if (timer) clearTimeout(timer)
            document.removeEventListener("selectionchange", schedule)
            document.removeEventListener("pointerdown", onPointerDown, true)
            document.removeEventListener("pointerup", onPointerUp, true)
            document.removeEventListener("pointercancel", onPointerUp, true)
            document.removeEventListener("keyup", schedule)
            document.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("resize", reposition)
            document.removeEventListener("scroll", reposition, true)
        }
    }, [enabled, rootRef, onReply])

    return {candidate, dismiss}
}
