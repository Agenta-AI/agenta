import {useEffect, type RefObject} from "react"

/**
 * Drives `.ag-scroll-fade` (surfaces.css) on a scroll box: sets `data-fade-top`/`-bottom` when
 * there is more to scroll that way. `insetSelector` names a sticky heading the top fade starts
 * below. Writes the DOM, not state, so scrolling never re-renders.
 */
export const useScrollFadeEdges = (
    ref: RefObject<HTMLElement | null>,
    {enabled = true, insetSelector}: {enabled?: boolean; insetSelector?: string} = {},
) => {
    useEffect(() => {
        const box = ref.current
        if (!box || !enabled) return
        const sync = () => {
            const {scrollTop, scrollHeight, clientHeight} = box
            // 1px slack: fractional zoom stops scrollTop just short of the end.
            box.dataset.fadeTop = String(scrollTop > 1)
            box.dataset.fadeBottom = String(scrollHeight - clientHeight - scrollTop > 1)
            const inset = insetSelector
                ? (box.querySelector<HTMLElement>(insetSelector)?.offsetHeight ?? 0)
                : 0
            box.style.setProperty("--ag-fade-inset", `${inset}px`)
        }
        sync()
        box.addEventListener("scroll", sync, {passive: true})
        // Content loads and resizes without a scroll event.
        const observer = new ResizeObserver(sync)
        observer.observe(box)
        for (const child of Array.from(box.children)) observer.observe(child)
        return () => {
            box.removeEventListener("scroll", sync)
            observer.disconnect()
            delete box.dataset.fadeTop
            delete box.dataset.fadeBottom
        }
    }, [ref, enabled, insetSelector])
}
