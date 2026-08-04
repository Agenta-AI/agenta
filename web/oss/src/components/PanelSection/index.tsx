import type {ReactNode} from "react"

/**
 * THROWAWAY — a local trial of the section language for `/apps` and `/overview`, so it can be
 * judged before anything is extracted into `@agenta/ui`. Do not import this from a package.
 *
 * Modelled on Claude's project page rather than on our playground panel. Two rules carry most of
 * it: the rail is ONE bordered container holding hairline-separated sections, and the main column
 * has no container at all — bare rows under a muted label. That contrast is what keeps the page
 * from reading as uniform; when both columns were sheets with filled header bands, every region
 * looked equally important and the density read as clutter.
 *
 * There are no filled bands here. Section headers are distinguished by weight and size, which is
 * also why the type scale on these two pages runs wider than the app's 12px default.
 */

/** The rail's container. The border is deliberate and used exactly once — around the whole rail,
 * never around each section inside it. */
export const PanelSurface = ({children, className}: {children: ReactNode; className?: string}) => (
    <div
        className={`box-border overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer ${className ?? ""}`}
    >
        {children}
    </div>
)

/**
 * The scrolling half of the rail, INSIDE {@link PanelSurface}.
 *
 * The column used to scroll and the surface rode along inside it, which broke twice: the surface's
 * own top border scrolled away and left the pinned header floating against nothing, and a surface
 * told to fill the column clipped whatever exceeded it, since the column never grew past its own
 * height and so never scrolled. Scrolling belongs inside the frame: the border stays put, the
 * headers pin just below it, and nothing is unreachable.
 *
 * The frame is capped (`max-h-full`), not stretched: a stretched frame is full of empty bordered
 * container whenever the sections don't reach the bottom, which is most of the time.
 */
export const PanelScroll = ({children}: {children: ReactNode}) => (
    <div className="min-h-0 shrink overflow-y-auto">{children}</div>
)

export const PanelSection = ({
    title,
    titleExtra,
    extra,
    sticky = false,
    variant = "rail",
    bodyClassName,
    minHeightClassName,
    children,
}: {
    title: ReactNode
    /** Rendered beside the title, e.g. a count or a "2 waiting" badge. */
    titleExtra?: ReactNode
    /** Rendered at the header's right edge, e.g. "View all". */
    extra?: ReactNode
    /**
     * Pin the header while its own section scrolls past. The background it carries is opaque
     * rather than a fill token — a sticky header with an rgba fill lets the rows scroll through
     * it visibly.
     */
    sticky?: boolean
    /** `rail` sits inside {@link PanelSurface}; `page` sits bare on the page background. */
    variant?: "rail" | "page"
    bodyClassName?: string
    minHeightClassName?: string
    children: ReactNode
}) => {
    const isRail = variant === "rail"
    return (
        <section className={`flex flex-col ${minHeightClassName ?? ""}`}>
            {/* Only the rail's headers pin, and only they carry a background. A bare section has
                no surface of its own to match — painting one drew a bar in a shade the page never
                uses — and the reference doesn't pin its main-column label either. */}
            <div
                className={`flex shrink-0 items-center justify-between gap-2 ${
                    isRail
                        ? `border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-4 py-3 ${
                              sticky ? "sticky top-0 z-10" : ""
                          }`
                        : "px-2 pb-2 pt-1"
                }`}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <h3
                        className={`m-0 truncate text-[15px] ${
                            isRail
                                ? "font-semibold text-colorText"
                                : "font-medium text-colorTextSecondary"
                        }`}
                    >
                        {title}
                    </h3>
                    {titleExtra}
                </div>
                {extra}
            </div>
            <div className={bodyClassName ?? "flex flex-col px-2 py-1"}>{children}</div>
        </section>
    )
}
