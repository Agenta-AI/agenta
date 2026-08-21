import type {CSSProperties, ReactNode, RefObject, UIEventHandler} from "react"

interface ScreenScaffoldProps {
    /** Pinned above the scroller. Never scrolls away. */
    header?: ReactNode
    /** Pinned below the scroller (approval dock, composer). */
    footer?: ReactNode
    scrollRef?: RefObject<HTMLDivElement | null>
    /** Extra classes on the SCROLLER itself — the chat's bottom-fade hover hook needs to sit on
     * the scrolling box, not on the page frame. */
    scrollClassName?: string
    /** Inline style on the scroller. The chat's top-edge fade is a CSS mask, which has no
     * Tailwind class. */
    scrollStyle?: CSSProperties
    onScroll?: UIEventHandler<HTMLDivElement>
    /** Inside a pane that already owns the viewport height and the top inset — fill it instead. */
    embedded?: boolean
    /**
     * The child owns the scrolling, so the middle is a plain fill region instead of a scroller.
     *
     * For screens whose body is itself a frame with its own scroll geometry — a `FilterRailLayout`,
     * whose rail must stay put while only the results column scrolls. Nesting that inside the
     * default scroller breaks both halves: the rail gets content height (so it scrolls away with
     * the page and its surface stops short) and the results column has no definite height to
     * scroll within.
     */
    fill?: boolean
    children: ReactNode
}

/**
 * The one mobile screen shape: a viewport-height column whose header and footer are pinned and
 * whose middle either scrolls (the default) or is filled by a child that scrolls itself (`fill`).
 *
 * `h-dvh` + an `overflow-y-auto` middle keeps scrolling inside the list rather than the
 * document — a `min-h-dvh` page scrolls its own header off-screen on iOS, which is the bug this
 * exists to prevent. The bottom-most element owns the bottom safe-area inset, so the scroller
 * only pads for it when there is no footer. The column itself owns the TOP inset: the app
 * declares `viewport-fit=cover`, so without this the pinned header sits under the status bar
 * in fullscreen/standalone contexts (zero in in-browser Safari, where env() resolves to 0).
 */
export const ScreenScaffold = ({
    header,
    footer,
    scrollRef,
    scrollClassName,
    scrollStyle,
    onScroll,
    embedded = false,
    fill = false,
    children,
}: ScreenScaffoldProps) => (
    <div
        className={`bg-background text-foreground flex min-h-0 flex-col ${
            embedded ? "h-full" : "h-dvh pt-[env(safe-area-inset-top)]"
        }`}
    >
        {header}
        <div
            ref={scrollRef}
            onScroll={onScroll}
            style={scrollStyle}
            className={`flex min-h-0 flex-1 flex-col ${
                fill ? "" : "overflow-y-auto overscroll-contain"
            }${footer ? "" : " pb-[env(safe-area-inset-bottom)]"}${
                scrollClassName ? ` ${scrollClassName}` : ""
            }`}
        >
            {children}
        </div>
        {footer}
    </div>
)
