import {SkeletonBlock} from "@agenta/ui/ui"

/** Mirrors a queue row (name line, updated line) so the list does not shift when data lands. */
export const AddToQueuePickerSkeleton = ({rows = 4}: {rows?: number}) => (
    <div className="flex flex-col gap-3 px-3 py-2" aria-hidden>
        {Array.from({length: rows}, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
                <SkeletonBlock className="h-3.5 w-2/3" />
                <SkeletonBlock className="h-3 w-1/3" />
            </div>
        ))}
    </div>
)
