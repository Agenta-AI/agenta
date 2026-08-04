import type {ReactNode} from "react"

/**
 * THROWAWAY — a local trial of the playground panel's section language, so the look can be
 * judged before anything is extracted into `@agenta/ui`. Do not import this from a package.
 *
 * The rail and overview marked every region with the same 1px outlined box, which is what made
 * the pages read as a wireframe: one surface level, uniform rectangles, and the border — the
 * signal that should mark an ITEM — spent on containers instead. The panel does it with surface:
 * a column is one continuous sheet, and regions are separated by a filled header band and a
 * hairline. Boxes survive only one level in, around actual items.
 */

/**
 * The band's fill must sit on an OPAQUE base: these headers are sticky, and a bare rgba fill
 * token lets the rows scroll through visibly. Same technique as the config panel's header bar,
 * with `colorBgContainer` in place of that copy's `--ag-c-FFFFFF` compat literal.
 */
const BAND_CLASS =
    "flex h-10 shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-colorBorderSecondary px-4 " +
    "bg-colorBgContainer bg-[image:linear-gradient(var(--ant-color-fill-tertiary),var(--ant-color-fill-tertiary))]"

/**
 * The sheet a column's sections live on. No border — the surface step against the page's own
 * background is what bounds it, and an outline here would reintroduce what we are removing.
 *
 * `overflow-clip`, NOT `overflow-hidden`: hidden makes this a scroll container, and the section
 * bands inside resolve their `sticky` against it. Since it never scrolls they would simply never
 * pin — the same trap the session card's own comment warned about. Clip rounds the corners
 * without creating that container.
 */
export const PanelSurface = ({children, className}: {children: ReactNode; className?: string}) => (
    <div className={`box-border overflow-clip rounded-lg bg-colorBgContainer ${className ?? ""}`}>
        {children}
    </div>
)

export const PanelSection = ({
    title,
    titleExtra,
    extra,
    sticky = false,
    bodyClassName = "flex flex-col px-2 py-2",
    minHeightClassName,
    children,
}: {
    title: ReactNode
    /** Rendered beside the title, e.g. a count or a "2 waiting" badge. */
    titleExtra?: ReactNode
    /** Rendered at the band's right edge, e.g. "View all". */
    extra?: ReactNode
    /** Pin the band while its own section scrolls past. Only meaningful in a scrolling column. */
    sticky?: boolean
    bodyClassName?: string
    minHeightClassName?: string
    children: ReactNode
}) => (
    <section className={`flex flex-col ${minHeightClassName ?? ""}`}>
        <div className={`${BAND_CLASS} ${sticky ? "sticky top-0 z-10" : ""}`}>
            <div className="flex min-w-0 items-center gap-2">
                <h3 className="m-0 truncate text-[13px] font-semibold text-colorText">{title}</h3>
                {titleExtra}
            </div>
            {extra}
        </div>
        <div className={bodyClassName}>{children}</div>
    </section>
)
