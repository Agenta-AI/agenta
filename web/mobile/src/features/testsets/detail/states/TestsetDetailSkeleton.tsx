import {SkeletonBlock} from "@agenta/ui/ui"

const GRID_ROWS = 8

/** The test set page while it loads: the title row, the toolbar and the grid rows. */
export const TestsetDetailSkeleton = () => (
    <div aria-busy="true" aria-label="Loading test set" className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
            <SkeletonBlock active className="h-7 w-48" />
            <SkeletonBlock active className="h-6 w-10" />
        </div>
        <SkeletonBlock active className="h-4 w-full max-w-xl" />
        <div className="flex flex-wrap gap-2">
            <SkeletonBlock active className="h-8 w-24" />
            <SkeletonBlock active className="h-8 w-24" />
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
            {Array.from({length: GRID_ROWS}, (_, index) => (
                <SkeletonBlock key={index} active className="h-8 w-full" />
            ))}
        </div>
    </div>
)
