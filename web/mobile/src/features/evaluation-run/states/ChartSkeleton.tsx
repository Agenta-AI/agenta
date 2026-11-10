import {SkeletonBlock} from "@agenta/ui/ui"

/** A chart-sized placeholder with an accessible label, so a screen reader hears what loads. */
export const ChartSkeleton = ({label, height}: {label: string; height: number}) => (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
        <SkeletonBlock className="h-4 w-1/3" />
        <SkeletonBlock style={{height}} className="w-full" />
    </div>
)
