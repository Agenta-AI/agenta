import {SkeletonBlock} from "@agenta/ui/ui"

/** The template list while the catalog loads: rows shaped like a tag over two description lines. */
export const EvaluatorTemplatesSkeleton = () => (
    <div className="flex flex-col gap-1" aria-busy="true" aria-label="Loading templates">
        {Array.from({length: 5}, (_, index) => (
            <div key={index} className="flex flex-col gap-2 px-3 py-2.5">
                <SkeletonBlock className="h-[22px] w-28 rounded-md" />
                <SkeletonBlock className="h-3.5 w-full" />
                <SkeletonBlock className="h-3.5 w-2/3" />
            </div>
        ))}
    </div>
)
