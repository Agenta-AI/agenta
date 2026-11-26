import {SkeletonBlock} from "@agenta/ui/ui"

/** One analytics card while it loads: the title, the value and the chart at their real sizes. */
export const AnalyticsCardSkeleton = () => (
    <div className="flex min-w-0 flex-col rounded-xl bg-muted px-5 pb-4 pt-4">
        <SkeletonBlock active className="h-5 w-28" />
        <div className="mt-1 flex min-h-7 items-baseline">
            <SkeletonBlock active className="h-6 w-24" />
        </div>
        <SkeletonBlock active className="mt-3 h-36 w-full" />
    </div>
)
