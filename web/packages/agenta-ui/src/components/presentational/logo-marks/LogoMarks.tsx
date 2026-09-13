import {SimpleTooltip} from "../../ui"

/** A run of brand logos, side by side, each naming itself on hover. */
export interface LogoMark {
    /** Stable identity, and the fallback label when the item has no name. */
    key: string
    name?: string
    logo?: string | null
}

export interface LogoMarksProps {
    items: LogoMark[]
    /** Names the run for a screen reader, e.g. "Connected apps". */
    label?: string
    /** Logo edge in px. 16 matches the template cards; 14 suits a dense two-line row. */
    size?: number
    /** Show at most this many, then a "+N" chip. Omit to show every one. */
    max?: number
    /** Rendered in place of an empty run. Omit to render nothing at all. */
    empty?: React.ReactNode
    /** Overlap the marks into a run. For a dense row end, where a spaced run is too wide. */
    stacked?: boolean
}

/** An item with no logo still has to occupy its slot, or the run reflows as logos load. */
function Mark({
    item,
    size,
    stacked,
    first,
}: {
    item: LogoMark
    size: number
    stacked?: boolean
    first?: boolean
}) {
    const label = item.name || item.key
    return (
        <SimpleTooltip title={label}>
            {/* role/aria-label on the wrapper, not only on the img: the fallback tile has no alt
                text of its own, so without this a logo-less app is invisible to a screen reader. */}
            <span
                role="listitem"
                aria-label={label}
                // Overlap only, no ring behind it. A ring can be one colour, and these sit on a
                // transparent row over the page — and over the hover fill on top of that — so in
                // `colorBgContainer` it was a bright halo biting into its neighbour in both themes.
                className="inline-flex shrink-0"
                // The tuck scales with the mark: a fixed 4px was a quarter of a 13px logo and left
                // the run reading as one smudge, while barely showing on a large one.
                style={{
                    width: size,
                    height: size,
                    ...(stacked && !first ? {marginLeft: -Math.round(size * 0.18)} : {}),
                }}
            >
                {item.logo ? (
                    // Plain img, not next/image: remote brand CDNs would need a host list per app.
                    <img
                        src={item.logo}
                        alt={label}
                        width={size}
                        height={size}
                        className="shrink-0 rounded-[3px] object-contain"
                    />
                ) : (
                    // No mark to draw: a neutral tile keeps the run aligned and still names itself.
                    <span
                        className="flex size-full items-center justify-center rounded-[3px] bg-[var(--ag-colorFillQuaternary)] text-[9px] font-medium uppercase text-[var(--ag-colorTextTertiary)]"
                        aria-hidden
                    >
                        {label.slice(0, 1)}
                    </span>
                )}
            </span>
        </SimpleTooltip>
    )
}

export const LogoMarks = ({items, size = 16, max, empty, label, stacked}: LogoMarksProps) => {
    if (items.length === 0) return <>{empty ?? null}</>

    const shown = max ? items.slice(0, max) : items
    const overflow = items.slice(shown.length)
    const overflowNames = overflow.map((i) => i.name || i.key).join(", ")

    return (
        <div
            role="list"
            aria-label={label}
            className={`flex items-center ${stacked ? "gap-0" : "gap-1.5"}`}
        >
            {shown.map((item, i) => (
                <Mark key={item.key} item={item} size={size} stacked={stacked} first={i === 0} />
            ))}
            {overflow.length > 0 ? (
                <SimpleTooltip title={overflowNames}>
                    {/* The names go in the accessible label too: a tooltip on a non-focusable
                        span is pointer-only, so "+3" alone told a screen reader nothing. */}
                    <span
                        role="listitem"
                        aria-label={`${overflow.length} more: ${overflowNames}`}
                        className="shrink-0 text-xs text-[var(--ag-colorTextTertiary)]"
                    >
                        +{overflow.length}
                    </span>
                </SimpleTooltip>
            ) : null}
        </div>
    )
}
