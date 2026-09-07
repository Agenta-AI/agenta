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
}

/** An item with no logo still has to occupy its slot, or the run reflows as logos load. */
function Mark({item, size}: {item: LogoMark; size: number}) {
    const label = item.name || item.key
    return (
        <SimpleTooltip title={label}>
            {/* role/aria-label on the wrapper, not only on the img: the fallback tile has no alt
                text of its own, so without this a logo-less app is invisible to a screen reader. */}
            <span
                role="listitem"
                aria-label={label}
                className="inline-flex shrink-0"
                style={{width: size, height: size}}
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

export const LogoMarks = ({items, size = 16, max, empty, label}: LogoMarksProps) => {
    if (items.length === 0) return <>{empty ?? null}</>

    const shown = max ? items.slice(0, max) : items
    const overflow = items.slice(shown.length)
    const overflowNames = overflow.map((i) => i.name || i.key).join(", ")

    return (
        <div role="list" aria-label={label} className="flex items-center gap-1.5">
            {shown.map((item) => (
                <Mark key={item.key} item={item} size={size} />
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
