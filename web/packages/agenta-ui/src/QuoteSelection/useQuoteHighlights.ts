/**
 * Paints the quoted spans using the CSS Custom Highlight API.
 *
 * NOT `<mark>` DOM surgery (which the prototype used): React wipes injected nodes on the next
 * render and virtualised rows unmount underneath them. A held `Range` plus `CSS.highlights` mutates
 * no DOM, adds no nodes, causes no reflow, and paints in the browser's own highlight pass — the
 * same approach the editor's search plugin already uses here.
 *
 * Upkeep is O(quotes), not O(transcript): each commit only asks whether a held range's container is
 * still connected. Re-resolution — a text walk over the root — runs solely when that goes false,
 * which means a virtualised row remounted. Browsers without the API simply show no highlight; the
 * composer chips still carry the quote.
 */
import {useEffect} from "react"

import {normalizeQuoteText, type Quote} from "@agenta/shared/quotes"

import {getQuoteRange, setQuoteRange} from "./sources"

const LIVE = "agenta-quote"
const STALE = "agenta-quote-stale"
const STYLE_ID = "agenta-quote-highlight-styles"

const supported = () =>
    typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS

/** The design's quiet fill plus a 2px bottom rule; warn-toned once the source has moved. */
const ensureStyles = () => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
::highlight(${LIVE}) {
    background-color: color-mix(in srgb, var(--ag-colorPrimary, #1668dc) 16%, transparent);
    text-decoration: underline;
    text-decoration-color: var(--ag-colorPrimary, #1668dc);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}
::highlight(${STALE}) {
    background-color: color-mix(in srgb, var(--ag-colorWarning, #d89614) 16%, transparent);
    text-decoration: underline;
    text-decoration-color: var(--ag-colorWarning, #d89614);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}`
    document.head.appendChild(style)
}

/**
 * Walk `root` for the quote's text and rebuild a range over it. Only called when a held range's
 * node has left the document.
 */
const resolveRange = (root: HTMLElement, text: string): Range | null => {
    const needle = normalizeQuoteText(text)
    if (!needle) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    const parts: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text)
        parts.push((node as Text).data)
    }
    const flat = parts.join("")
    // Match on a whitespace-tolerant pattern so a selection that crossed element boundaries still
    // resolves against the concatenated text nodes.
    const pattern = needle
        .split(" ")
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+")
    const match = new RegExp(pattern).exec(flat)
    if (!match) return null

    const locate = (offset: number): {node: Text; offset: number} | null => {
        let seen = 0
        for (let i = 0; i < nodes.length; i++) {
            const len = parts[i].length
            if (offset <= seen + len) return {node: nodes[i], offset: offset - seen}
            seen += len
        }
        return null
    }
    const start = locate(match.index)
    const end = locate(match.index + match[0].length)
    if (!start || !end) return null
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
}

export const useQuoteHighlights = (
    rootRef: React.RefObject<HTMLElement | null>,
    quotes: Quote[],
    enabled: boolean,
) => {
    useEffect(() => {
        if (!enabled || !supported()) return
        ensureStyles()
        const root = rootRef.current
        if (!root) return

        const live: Range[] = []
        const stale: Range[] = []
        quotes.forEach((quote) => {
            let range = getQuoteRange(quote.id)
            // The cheap check, every commit. A full re-resolve only when the anchor really left.
            if (!range || !range.startContainer.isConnected) {
                range = resolveRange(root, quote.text) ?? undefined
                setQuoteRange(quote.id, range ?? null)
            }
            // A row that scrolled out under `content-visibility:auto` resolves to nothing this
            // frame; the chip still stands and the highlight returns when it scrolls back in.
            if (!range) return
            ;(quote.stale ? stale : live).push(range)
        })

        const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights
        const Ctor = (window as unknown as {Highlight: new (...r: Range[]) => unknown}).Highlight
        highlights.set(LIVE, new Ctor(...live))
        highlights.set(STALE, new Ctor(...stale))
    })

    useEffect(() => {
        if (!enabled || !supported()) return
        return () => {
            const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights
            highlights.delete(LIVE)
            highlights.delete(STALE)
        }
    }, [enabled])
}
