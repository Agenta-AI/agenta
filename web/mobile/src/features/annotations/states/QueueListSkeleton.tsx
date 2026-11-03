import {SkeletonBlock} from "@agenta/ui/ui"

/** Rows shaped like the list's phone layout (name, reviewed, status), so the list does not jump. */
export const QueueListSkeleton = ({rows = 8}: {rows?: number}) => (
    <div className="flex flex-col" role="status" aria-label="Loading queues">
        {Array.from({length: rows}, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border py-3.5">
                <SkeletonBlock className="h-4 min-w-0 flex-1" />
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-5 w-20" />
            </div>
        ))}
    </div>
)
