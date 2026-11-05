import {SkeletonBlock} from "@agenta/ui/ui"

/** The Configuration tab while its code loads: the summary card and two sections. */
export const ConfigurationSkeleton = () => (
    <div
        role="status"
        aria-label="Loading configuration"
        className="grid grid-cols-1 gap-4 lg:grid-cols-[264px_minmax(0,1fr)]"
    >
        <SkeletonBlock className="h-40 w-full rounded-lg" />
        <div className="flex flex-col gap-4">
            <SkeletonBlock className="h-32 w-full rounded-lg" />
            <SkeletonBlock className="h-48 w-full rounded-lg" />
        </div>
    </div>
)
