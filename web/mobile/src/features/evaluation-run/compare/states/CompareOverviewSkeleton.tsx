import {SkeletonBlock} from "@agenta/ui/ui"

/** The compared overview while its code loads: the summary card, in its final place. */
export const CompareOverviewSkeleton = () => (
    <div
        role="status"
        aria-label="Loading comparison"
        className="box-border flex flex-col gap-4 rounded-lg border border-solid border-border p-4"
    >
        <SkeletonBlock className="h-5 w-56" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                    <SkeletonBlock key={index} className="h-5" />
                ))}
            </div>
            <SkeletonBlock className="h-[300px]" />
        </div>
    </div>
)
