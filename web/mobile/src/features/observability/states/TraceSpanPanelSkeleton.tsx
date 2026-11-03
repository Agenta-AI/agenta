import {SkeletonBlock} from "@agenta/ui/ui"

/** Holds a drill-in panel's place while its code loads on the first open span. */
export const TraceSpanPanelSkeleton = () => (
    <div className="flex flex-col gap-2 py-2" aria-hidden>
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-20 w-full" />
    </div>
)
