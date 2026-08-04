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
        // Opaque, not a fill: the sticky headers inside must hide the rows scrolling under them,
        // and a translucent surface lets them show through. `colorBgElevated` is the app's existing
        // elevation shade (every dropdown, modal and popover sits on it) rather than a new one.
        className={`box-border overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated ${className ?? ""}`}
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

/**
 * The one style for a section header's action — "View all", "Expand", "+ New agent".
 *
 * They had drifted into three treatments (accent link, accent link with a leading plus, muted text
 * with a caret), which read as three different kinds of action sitting in identical headers. A
 * header action is always secondary to the section's rows: muted at rest, full-strength on hover.
 */
export const PANEL_ACTION_CLASS =
    "inline-flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs !text-colorTextSecondary transition-colors hover:!text-colorText"

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
     * Pin the header while its own section scrolls past. The background it carries is the opaque
     * page/rail surface, never a fill token — an rgba fill lets the rows scroll through it visibly,
     * and `colorBgLayout` is a shade neither surface actually uses.
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
        <section
            className={`flex flex-col ${
                isRail
                    ? "border-0 border-t border-solid border-colorBorderSecondary first:border-t-0"
                    : ""
            } ${minHeightClassName ?? ""}`}
        >
            {/* The rule belongs BETWEEN sections, not under a header: a header with a rule under it
                reads as a table head over its rows, and leaves the boundary that matters — one
                section's last row against the next one's title — completely unmarked. */}
            <div
                className={`flex shrink-0 items-center justify-between gap-2 ${
                    isRail
                        ? `bg-colorBgElevated px-4 pb-2 pt-4 ${sticky ? "sticky top-0 z-10" : ""}`
                        : `px-2 pb-2 pt-2 ${
                              // The page surface is colorBgContainer (#141414 dark / #fff light);
                              // colorBgLayout is pure black and paints a bar the page never uses.
                              sticky ? "sticky top-0 z-10 bg-colorBgContainer" : ""
                          }`
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
            {/* Rows inside a rail section separate by spacing, never by a rule — a rule inside a
                section competes with the rule that ends it. Lines mean "new section", nothing else. */}
            <div className={bodyClassName ?? "flex flex-col gap-0.5 px-2 pb-3"}>{children}</div>
        </section>
    )
}
