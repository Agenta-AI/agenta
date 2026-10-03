// Paints open drafts via the CSS Custom Highlight API: no DOM surgery for React to wipe.
import {useEffect} from "react"

const NAME = "agenta-quote"
const STYLE_ID = "agenta-quote-highlight-styles"

// Shared by every layer, so one pane's draft never erases another's.
const painted = new Set<Range>()

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS

const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `::highlight(${NAME}) {
    background-color: color-mix(in srgb, var(--ag-colorPrimary, #1668dc) 16%, transparent);
    text-decoration: underline 2px var(--ag-colorPrimary, #1668dc);
    text-underline-offset: 3px;
}`
    document.head.appendChild(style)
}

const repaint = () => {
    const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights
    if (painted.size === 0) {
        highlights.delete(NAME)
        return
    }
    const Ctor = (window as unknown as {Highlight: new (...r: Range[]) => unknown}).Highlight
    highlights.set(NAME, new Ctor(...painted))
}

export const useDraftHighlight = (range: Range | null) => {
    useEffect(() => {
        if (!range || !supported()) return
        ensureStyles()
        painted.add(range)
        repaint()
        return () => {
            painted.delete(range)
            repaint()
        }
    }, [range])
}
