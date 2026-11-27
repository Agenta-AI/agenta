import {cn} from "../../ui/utils"

export interface ShareBarSegment {
    key: string
    /** 0..1 of the bar's width. */
    share: number
    /** CSS color, for example `var(--success)` or `var(--data-1)`. */
    color: string
    /** Tooltip of the segment. */
    title?: string
    /** Diagonal stripes of the color, for a part with no value ("no result"). */
    striped?: boolean
}

/**
 * One thin bar split into segments by share: a pass rate (passed and failed) or the values of a
 * category. The part no segment fills shows the track.
 */
export function ShareBar({
    segments,
    title,
    label,
    className,
}: {
    segments: readonly ShareBarSegment[]
    /** Tooltip of the whole bar. */
    title?: string
    /** Accessible name of the bar. */
    label?: string
    className?: string
}) {
    return (
        <div
            role="img"
            aria-label={label ?? title}
            title={title}
            className={cn("flex h-1.5 w-full overflow-hidden rounded-xs bg-selected", className)}
        >
            {segments
                .filter((segment) => segment.share > 0)
                .map((segment) => (
                    <div
                        key={segment.key}
                        data-segment={segment.key}
                        title={segment.title}
                        className="h-full"
                        style={{
                            width: `${Math.min(1, segment.share) * 100}%`,
                            background: segment.striped
                                ? `repeating-linear-gradient(135deg, ${segment.color} 0 2px, transparent 2px 4px)`
                                : segment.color,
                        }}
                    />
                ))}
        </div>
    )
}
