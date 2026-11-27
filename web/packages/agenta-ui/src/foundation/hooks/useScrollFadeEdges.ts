import {useEffect, type RefObject} from "react"

/**
 * Drives `.ag-scroll-fade` on a scroll box, or `.ag-scroll-fade-x` with `axis: "x"`;
 * `insetSelector` names a sticky heading to fade below.
 */
export const useScrollFadeEdges = (
    ref: RefObject<HTMLElement | null>,
    {
        enabled = true,
        insetSelector,
        axis = "y",
    }: {enabled?: boolean; insetSelector?: string; axis?: "x" | "y"} = {},
) => {
    useEffect(() => {
        const box = ref.current
        if (!box || !enabled) return
        const sync = () => {
            if (axis === "x") {
                const {scrollLeft, scrollWidth, clientWidth} = box
                box.dataset.fadeLeft = String(scrollLeft > 1)
                box.dataset.fadeRight = String(scrollWidth - clientWidth - scrollLeft > 1)
                return
            }
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
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync)
        observer?.observe(box)
        for (const child of Array.from(box.children)) observer?.observe(child)
        return () => {
            box.removeEventListener("scroll", sync)
            observer?.disconnect()
            delete box.dataset.fadeTop
            delete box.dataset.fadeBottom
            delete box.dataset.fadeLeft
            delete box.dataset.fadeRight
        }
    }, [ref, enabled, insetSelector, axis])
}
