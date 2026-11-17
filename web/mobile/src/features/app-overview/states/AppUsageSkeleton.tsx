import {Skeleton} from "@agenta/ui/ui"

/** The usage charts in grey: the window picker and the 2x2 grid of chart cards. */
export const AppUsageSkeleton = () => (
    <div className="flex flex-col gap-4" aria-label="Loading usage">
        <div className="flex justify-end">
            <Skeleton className="h-8 w-[140px] rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-[252px] w-full rounded-lg" />
            ))}
        </div>
    </div>
)
