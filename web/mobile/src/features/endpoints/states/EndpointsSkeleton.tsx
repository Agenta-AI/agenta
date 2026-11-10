import {SkeletonBlock} from "@agenta/ui/ui"

/** The page body while the apps, variants or environments load: the final layout, no text. */
export const EndpointsSkeleton = () => (
    <div className="flex flex-col gap-5" data-testid="endpoints-skeleton" aria-busy="true">
        <SkeletonBlock className="h-5 w-3/4 max-w-md" />
        <div className="flex items-center gap-2">
            <SkeletonBlock className="h-control w-24" />
            <SkeletonBlock className="h-control w-20" />
            <SkeletonBlock className="h-control w-20" />
        </div>
        <div className="flex flex-col gap-2">
            <SkeletonBlock className="h-11 w-full" />
            <SkeletonBlock className="h-11 w-full" />
        </div>
    </div>
)
