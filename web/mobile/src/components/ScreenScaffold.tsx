import type {ReactNode, RefObject, UIEventHandler} from "react"

interface ScreenScaffoldProps {
    /** Pinned above the scroller. Never scrolls away. */
    header?: ReactNode
    /** Pinned below the scroller (approval dock, composer). */
    footer?: ReactNode
    scrollRef?: RefObject<HTMLDivElement | null>
    onScroll?: UIEventHandler<HTMLDivElement>
    children: ReactNode
}

/**
 * The one mobile screen shape: a viewport-height column whose header and footer are pinned and
 * whose middle is the ONLY scroller.
 *
 * `h-dvh` + an `overflow-y-auto` middle keeps scrolling inside the list rather than the
 * document — a `min-h-dvh` page scrolls its own header off-screen on iOS, which is the bug this
 * exists to prevent. The bottom-most element owns the safe-area inset, so the scroller only
 * pads for it when there is no footer.
 */
export const ScreenScaffold = ({
    header,
    footer,
    scrollRef,
    onScroll,
    children,
}: ScreenScaffoldProps) => (
    <div className="bg-background text-foreground flex h-dvh flex-col">
        {header}
        <div
            ref={scrollRef}
            onScroll={onScroll}
            className={`flex flex-1 flex-col overflow-y-auto overscroll-contain${
                footer ? "" : " pb-[env(safe-area-inset-bottom)]"
            }`}
        >
            {children}
        </div>
        {footer}
    </div>
)
