import {SkeletonBlock} from "@agenta/ui/ui"

/**
 * The Annotate tab while the queue and its items load, in its three columns: the item list, the
 * content under its bar, and the annotation panel. The list column shows on wide screens only.
 */
export const QueueSessionSkeleton = () => (
    <div
        className="flex min-h-0 flex-1 flex-col md:flex-row"
        role="status"
        aria-label="Loading the annotation queue"
    >
        <div className="hidden w-62 shrink-0 flex-col gap-3 border-0 border-r border-solid border-border p-4 min-[1360px]:flex">
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="h-1" />
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-8" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:px-6">
            <SkeletonBlock className="h-7 w-48" />
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-40" />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 border-0 border-t border-solid border-border p-4 md:w-95 md:border-l md:border-t-0">
            <SkeletonBlock className="h-5 w-28" />
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-24" />
        </div>
    </div>
)
