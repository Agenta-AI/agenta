import {SkeletonBlock} from "@agenta/ui/ui"

/** Three rows the size of a candidate row, with the old app's loading text for screen readers. */
export const CompareRunsSkeleton = () => (
    <div className="flex flex-col gap-1 p-2" role="status">
        <span className="sr-only">Loading evaluations...</span>
        {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-start justify-between gap-3 px-2 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <SkeletonBlock className="h-4 w-40" />
                    <SkeletonBlock className="h-3 w-24" />
                </div>
                <SkeletonBlock className="h-5 w-16" />
            </div>
        ))}
    </div>
)
