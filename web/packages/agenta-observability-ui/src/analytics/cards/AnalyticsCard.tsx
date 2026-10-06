import type {ReactNode} from "react"

import {Button, SkeletonBlock, cn} from "@agenta/ui/ui"
import {CaretRight, ChartBar, WarningCircle} from "@phosphor-icons/react"

export interface AnalyticsCardProps {
    title: ReactNode
    value?: ReactNode
    caption?: ReactNode
    onExplore?: () => void
    /** Controls beside the title. */
    controls?: ReactNode
    legend?: ReactNode
    note?: ReactNode
    loading?: boolean
    error?: unknown
    onRetry?: () => void
    empty?: {text: string; onClear?: () => void} | null
    /** Fixed body height for a chart; omitted, the body sizes to its content. */
    chartHeight?: number
    className?: string
    children?: ReactNode
}

export const AnalyticsCard = ({
    title,
    value,
    caption,
    onExplore,
    controls,
    legend,
    note,
    loading,
    error,
    onRetry,
    empty,
    chartHeight,
    className,
    children,
}: AnalyticsCardProps) => (
    <section className={cn("flex min-w-0 flex-col rounded-xl bg-muted px-5 pb-4 pt-4", className)}>
        <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="text-sm text-muted-foreground">{title}</span>
                {controls}
            </div>
            {onExplore ? (
                <Button
                    variant="ghost"
                    size="xs"
                    className="-mr-2 text-muted-foreground"
                    onClick={onExplore}
                >
                    Explore
                    <CaretRight data-icon="inline-end" />
                </Button>
            ) : null}
        </div>
        <div className="mt-1 flex min-h-7 items-baseline gap-2">
            {loading ? (
                <SkeletonBlock className="h-6 w-24" />
            ) : (
                <>
                    {value != null ? (
                        <span className="truncate text-lg font-medium tracking-tight text-foreground">
                            {value}
                        </span>
                    ) : null}
                    {caption ? (
                        <span className="truncate text-xs text-muted-foreground">{caption}</span>
                    ) : null}
                </>
            )}
        </div>
        <div
            className={cn("relative mt-3", !chartHeight && (loading || error || empty) && "h-36")}
            style={chartHeight ? {height: chartHeight} : undefined}
        >
            {loading ? (
                <SkeletonBlock className="size-full" />
            ) : error ? (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <WarningCircle size={20} />
                    <span>Couldn’t load this chart</span>
                    {onRetry ? (
                        <Button variant="outline" size="xs" onClick={onRetry}>
                            Retry
                        </Button>
                    ) : null}
                </div>
            ) : empty ? (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <span className="grid size-8 place-items-center rounded-lg border border-solid border-border bg-background">
                        <ChartBar size={16} />
                    </span>
                    <span>{empty.text}</span>
                    {empty.onClear ? (
                        <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-2"
                            onClick={empty.onClear}
                        >
                            Clear filters
                        </button>
                    ) : null}
                </div>
            ) : (
                children
            )}
        </div>
        {!loading && !error && !empty && legend ? <div className="mt-3">{legend}</div> : null}
        {note ? <div className="mt-2 text-xs text-muted-foreground">{note}</div> : null}
    </section>
)

export interface LegendItem {
    key: string
    label: string
    color: string
    hidden?: boolean
}

export const ChartLegendRow = ({
    items,
    onToggle,
}: {
    items: LegendItem[]
    onToggle?: (key: string) => void
}) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
            <button
                key={item.key}
                type="button"
                disabled={!onToggle}
                onClick={() => onToggle?.(item.key)}
                className={cn(
                    "inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-muted-foreground",
                    onToggle && "cursor-pointer hover:text-foreground",
                    item.hidden && "line-through opacity-40",
                )}
            >
                <span className="size-2 rounded-full" style={{background: item.color}} />
                {item.label}
            </button>
        ))}
    </div>
)
