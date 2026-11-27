import {cn} from "../../ui/utils"

export interface MiniHistogramBar {
    key: string
    /** 0..1: the bar's height. */
    share: number
    /** Tooltip of the bar. */
    title?: string
}

/** A bar with a count above zero is still this tall, so it reads as "some", not "none". */
const MIN_VISIBLE = 0.06

/**
 * A small histogram for a table cell: bars side by side on one baseline, and a label at each end
 * of the axis. The bars come as they are; this component never bins.
 */
export function MiniHistogram({
    bars,
    start,
    end,
    label,
    color = "var(--data-1)",
    className,
}: {
    bars: readonly MiniHistogramBar[]
    /** Label under the left end of the axis, for example "0". */
    start: string
    /** Label under the right end of the axis, for example "1". */
    end: string
    /** Accessible name of the chart. */
    label: string
    /** CSS color of the bars. */
    color?: string
    className?: string
}) {
    return (
        <div role="img" aria-label={label} className={cn("flex flex-col gap-px", className)}>
            <div className="flex h-5 items-end gap-0.5 border-0 border-b border-solid border-border">
                {bars.map((bar) => (
                    <div
                        key={bar.key}
                        data-bar={bar.key}
                        title={bar.title}
                        className="flex h-full min-w-0 flex-1 items-end"
                    >
                        <div
                            className="w-full rounded-t-xs"
                            style={{
                                height: `${(bar.share > 0 ? Math.max(MIN_VISIBLE, Math.min(1, bar.share)) : 0) * 100}%`,
                                backgroundColor: color,
                            }}
                        />
                    </div>
                ))}
            </div>
            <div className="flex justify-between text-caption tabular-nums text-muted-foreground">
                <span>{start}</span>
                <span>{end}</span>
            </div>
        </div>
    )
}
