import {Activity, RefreshCw, TriangleAlert} from "lucide-react"

import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"

/**
 * Designed states for the observability lists.
 *
 * The skeleton mirrors a real row's geometry (glyph, two text lines, a metrics line) so the
 * list does not shift when data lands.
 */

export const ObservabilityListSkeleton = ({rows = 6}: {rows?: number}) => (
    <div className="flex flex-col divide-y divide-border" aria-hidden>
        {Array.from({length: rows}, (_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                </div>
            </div>
        ))}
    </div>
)

export const ObservabilityEmpty = ({
    title = "No traces yet",
    hint = "Traces appear here once your app sends them.",
}: {
    title?: string
    hint?: string
}) => (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <Activity className="size-6 text-muted-foreground" />
        <p className="m-0 text-sm font-medium text-foreground">{title}</p>
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
    </div>
)

export const ObservabilityFiltered = ({onClear}: {onClear: () => void}) => (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Activity className="size-6 text-muted-foreground" />
        <p className="m-0 text-sm font-medium text-foreground">Nothing matches these filters</p>
        <p className="m-0 text-xs text-muted-foreground">
            Try a wider time range, or clear the filters.
        </p>
        <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
        </Button>
    </div>
)

export const ObservabilityError = ({
    message = "Could not load traces.",
    onRetry,
}: {
    message?: string
    onRetry?: () => void
}) => (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-sm font-medium text-foreground">{message}</p>
        {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="size-3.5" />
                Try again
            </Button>
        ) : null}
    </div>
)
