import {useEffect} from "react"

/**
 * Publishes a scroll container's reserved scrollbar gutter as `--ag-scroll-gutter` on the
 * element itself. The width is platform-dependent (0 on overlay-scrollbar systems), so it
 * has to be measured rather than assumed. Pairs with the `.ag-scroll-bleed` rule, which
 * lets full-width rows stretch across the gutter instead of stopping short of it.
 */
export const useScrollbarGutterVar = (element: HTMLElement | null) => {
    useEffect(() => {
        if (!element) return

        const sync = () => {
            const gutter = element.offsetWidth - element.clientWidth
            element.style.setProperty("--ag-scroll-gutter", `${gutter}px`)
        }

        sync()

        const observer = new ResizeObserver(sync)
        observer.observe(element)

        return () => observer.disconnect()
    }, [element])
}

export default useScrollbarGutterVar
