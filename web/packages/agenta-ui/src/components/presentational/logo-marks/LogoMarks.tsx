import {SimpleTooltip} from "../../ui"

/**
 * A run of brand logos, side by side, each naming itself on hover.
 *
 * Logos next to each other rather than a logo-plus-name pair per item: the mark IS the name to
 * anyone who has seen the app before, and repeating "logo GitHub, logo Slack, logo Linear" spends a
 * whole line saying what four 16px squares already say. The tooltip carries the name for the reader
 * who does not recognise a mark.
 *
 * A plain `<img>`, not `next/image`: the sources are remote brand CDNs, and every app that renders
 * these would otherwise need each host in its own `images` config.
 */
export interface LogoMark {
    /** Stable identity, and the fallback label when the item has no name. */
    key: string
    name?: string
    logo?: string | null
}

export interface LogoMarksProps {
    items: LogoMark[]
    /** Logo edge in px. 16 matches the template cards; 14 suits a dense two-line row. */
    size?: number
    /** Show at most this many, then a "+N" chip. Omit to show every one. */
    max?: number
    /** Rendered in place of an empty run. Omit to render nothing at all. */
    empty?: React.ReactNode
    className?: string
}

/** An item with no logo still has to occupy its slot, or the run reflows as logos load. */
function Mark({item, size}: {item: LogoMark; size: number}) {
    const label = item.name || item.key
    return (
        <SimpleTooltip title={label}>
            <span className="inline-flex shrink-0" style={{width: size, height: size}}>
                {item.logo ? (
                    // Remote brand CDNs: next/image would make every consuming app declare each
                    // host in its own images config. See the note on this module.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={item.logo}
                        alt={label}
                        width={size}
                        height={size}
                        className="shrink-0 rounded object-contain"
                    />
                ) : (
                    // No mark to draw: a neutral tile keeps the run aligned and still names itself.
                    <span
                        className="flex size-full items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[9px] font-medium uppercase text-[var(--ag-colorTextTertiary)]"
                        aria-hidden
                    >
                        {label.slice(0, 1)}
                    </span>
                )}
            </span>
        </SimpleTooltip>
    )
}

export const LogoMarks = ({items, size = 16, max, empty, className}: LogoMarksProps) => {
    if (items.length === 0) return <>{empty ?? null}</>

    const shown = max ? items.slice(0, max) : items
    const hidden = items.length - shown.length

    return (
        <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
            {shown.map((item) => (
                <Mark key={item.key} item={item} size={size} />
            ))}
            {hidden > 0 ? (
                <SimpleTooltip
                    title={items
                        .slice(shown.length)
                        .map((i) => i.name || i.key)
                        .join(", ")}
                >
                    <span className="shrink-0 text-xs text-[var(--ag-colorTextTertiary)]">
                        +{hidden}
                    </span>
                </SimpleTooltip>
            ) : null}
        </div>
    )
}
