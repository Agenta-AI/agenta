import {Plus, RefreshCw, TriangleAlert, Zap} from "lucide-react"

import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"

/**
 * Designed states for the automations screens.
 *
 * The list skeleton mirrors a real table row (name over description, status pill, runs-when,
 * agent) so the rows do not shift when the two trigger queries land.
 */

export const AutomationListSkeleton = ({rows = 5}: {rows?: number}) => (
    <div className="flex flex-col divide-y divide-border" aria-hidden>
        {Array.from({length: rows}, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                <Skeleton className="hidden h-3 w-28 shrink-0 sm:block" />
                <Skeleton className="hidden h-3 w-20 shrink-0 sm:block" />
            </div>
        ))}
    </div>
)

export const AutomationListEmpty = ({onCreate}: {onCreate?: () => void}) => (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Zap className="size-6 text-muted-foreground" />
        <p className="m-0 text-sm font-medium text-foreground">No automations yet</p>
        <p className="m-0 text-xs text-muted-foreground">
            An automation runs one of your agents on a schedule, or when something happens in an
            app you connect.
        </p>
        {onCreate ? (
            <Button variant="outline" size="sm" onClick={onCreate}>
                <Plus className="size-3.5" />
                New automation
            </Button>
        ) : null}
    </div>
)

export const AutomationListError = ({
    message = "Could not load automations.",
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

export const AutomationDetailSkeleton = () => (
    <div className="flex flex-col gap-6 px-4 py-4" aria-hidden>
        {/* Identity: name, then the runs-when line under it. */}
        <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
        </div>
        {/* The status/agent/cadence facts row. */}
        <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
        </div>
        {/* The recent-runs list below them. */}
        <div className="flex flex-col divide-y divide-border">
            {Array.from({length: 4}, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                    <Skeleton className="size-2 shrink-0 rounded-full" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="ml-auto h-3 w-16 shrink-0" />
                </div>
            ))}
        </div>
    </div>
)
