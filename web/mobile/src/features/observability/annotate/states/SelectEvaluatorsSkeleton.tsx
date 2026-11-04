import {SkeletonBlock} from "@agenta/ui/ui"

/** The evaluator list while it loads: rows with a check box, a name and the "Metric" tag. */
export const SelectEvaluatorsSkeleton = () => (
    <div className="flex flex-col gap-1" aria-busy="true" aria-label="Loading evaluators">
        {Array.from({length: 4}, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-2 py-2">
                <SkeletonBlock className="size-4 rounded-sm" />
                <SkeletonBlock className="h-4 flex-1" />
                <SkeletonBlock className="h-4 w-12" />
            </div>
        ))}
    </div>
)
