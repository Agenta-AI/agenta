import {useEffect, type RefObject} from "react"

/**
 * Arms the drag engine on the menu root.
 *
 * The engine is imported LAZILY: `NavMenu` is a static import on every page, so eagerly bundling
 * ~300 lines of pointer machinery would tax every load for a gesture most sessions never make.
 * Same call as `ChatComposer` makes for Lexical. This component renders nothing.
 */
export const SidebarReorderLayer = ({
    containerRef,
}: {
    containerRef: RefObject<HTMLElement | null>
}) => {
    useEffect(() => {
        const root = containerRef.current
        if (!root) return
        let detach: (() => void) | null = null
        let cancelled = false

        // Armed on the first press that lands on a draggable row; the module is cached after that.
        const arm = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null
            if (detach || !target?.closest("[data-drag-zone]")) return
            void import("./engine").then(({attachReorder}) => {
                if (cancelled || detach) return
                detach = attachReorder(root)
                // Replay from the ORIGINAL target, not `root`: dispatching on `root` retargets the
                // event to `<nav>`, whose `closest("[data-drag-zone]")` is null, so the first drag
                // never starts. The event still bubbles up to the listener `attachReorder` added.
                target.dispatchEvent(new PointerEvent("pointerdown", event))
            })
        }

        root.addEventListener("pointerdown", arm)
        return () => {
            cancelled = true
            root.removeEventListener("pointerdown", arm)
            detach?.()
        }
    }, [containerRef])

    return null
}
