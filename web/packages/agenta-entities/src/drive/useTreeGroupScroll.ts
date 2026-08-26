/**
 * useTreeGroupScroll — the tree's PER-FOLDER-GROUP horizontal scroll: the measured content widths,
 * each group's offset, and the wheel interception that moves them. The two maps are refs (mutated in
 * place, no render per wheel tick), so they never leave this hook: rows read their offset through
 * `scrollXFor(parent)`, report their width through `onMeasureContent`, and the tree's scroll element
 * is handed to `attachTreeWheel` — which owns the non-passive listener and its teardown.
 */
import {useCallback, useEffect, useReducer, useRef} from "react"

export function useTreeGroupScroll({
    deferredSearch,
    showGitignored,
}: {
    deferredSearch: string
    showGitignored: boolean
}) {
    // PER-FOLDER-GROUP horizontal scroll: a folder's children share ONE offset, so reading a long name
    // scrolls all siblings together — never individual rows (that left odd gaps) nor the whole tree.
    // `groupScroll` = parent path → scrollLeft (transform on each row's content); `groupWidth` = parent
    // → widest child content, to clamp. A version bump re-renders the (few) visible rows on scroll.
    const groupScrollRef = useRef(new Map<string, number>())
    const groupWidthRef = useRef(new Map<string, number>())
    const [, bumpGroupScroll] = useReducer((n: number) => n + 1, 0)
    const onMeasureContent = useCallback((parent: string, width: number) => {
        if (width > (groupWidthRef.current.get(parent) ?? 0))
            groupWidthRef.current.set(parent, width)
    }, [])
    // A wholesale listing change (search / gitignore) invalidates the measured widths + offsets.
    useEffect(() => {
        groupWidthRef.current.clear()
        groupScrollRef.current.clear()
        bumpGroupScroll()
    }, [deferredSearch, showGitignored])

    /** This group's current horizontal offset — the transform a row applies to its content. */
    const scrollXFor = useCallback((parent: string) => groupScrollRef.current.get(parent) ?? 0, [])

    // Own the wheel to route horizontal deltas to the hovered row's group (transform) while vertical
    // stays native. Axis-locked per gesture (biased vertical) so a mostly-vertical swipe never nudges a
    // group sideways. Callback ref (the scroll div mounts after the skeleton) + non-passive listener.
    const detachTreeWheel = useRef<(() => void) | null>(null)
    const attachTreeWheel = useCallback((el: HTMLDivElement | null) => {
        detachTreeWheel.current?.()
        detachTreeWheel.current = null
        if (!el) return
        let axis: "x" | "y" | null = null
        let idle: ReturnType<typeof setTimeout> | undefined
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey) return // pinch-zoom
            if (axis === null) axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 ? "x" : "y"
            if (idle) clearTimeout(idle)
            idle = setTimeout(() => {
                axis = null
            }, 120)
            if (axis !== "x") return // vertical → native list scroll
            e.preventDefault()
            const rowEl = (e.target as HTMLElement | null)?.closest?.("[data-parent]")
            const parent = rowEl?.getAttribute("data-parent") ?? ""
            const unit = e.deltaMode === 1 ? 16 : 1
            const maxScroll = Math.max(
                0,
                (groupWidthRef.current.get(parent) ?? 0) - el.clientWidth + 8,
            )
            const cur = groupScrollRef.current.get(parent) ?? 0
            const next = Math.min(maxScroll, Math.max(0, cur + e.deltaX * unit))
            if (next !== cur) {
                groupScrollRef.current.set(parent, next)
                bumpGroupScroll()
            }
        }
        el.addEventListener("wheel", onWheel, {passive: false})
        detachTreeWheel.current = () => {
            el.removeEventListener("wheel", onWheel)
            if (idle) clearTimeout(idle)
        }
    }, [])

    return {onMeasureContent, scrollXFor, attachTreeWheel}
}

export type TreeGroupScroll = ReturnType<typeof useTreeGroupScroll>
