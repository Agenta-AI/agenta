import {SkeletonBlock} from "@agenta/ui/ui"

/** The focus layout while the queue and its items load: content, the form panel and the footer. */
export const QueueSessionSkeleton = () => (
    <div
        className="flex min-h-0 flex-1 flex-col"
        role="status"
        aria-label="Loading the annotation queue"
    >
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-3 md:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-solid border-border p-4">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-32" />
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-solid border-border p-4 md:w-[300px] lg:w-[400px] xl:w-[450px]">
                <SkeletonBlock className="h-5 w-28" />
                <SkeletonBlock className="h-8" />
                <SkeletonBlock className="h-8" />
            </div>
        </div>
        <div className="flex h-[55px] shrink-0 items-center gap-3 border-0 border-t border-solid border-border px-4">
            <SkeletonBlock className="h-6 w-20" />
            <SkeletonBlock className="ml-auto h-7 w-36" />
        </div>
    </div>
)
