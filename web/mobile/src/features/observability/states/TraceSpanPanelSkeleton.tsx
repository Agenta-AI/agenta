import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import type {DynamicOptionsLoadingProps} from "next/dynamic"

/**
 * Holds a drill-in panel's place while its code loads on the first open span. If the code fails
 * to load, it offers a retry instead of loading forever.
 */
export const TraceSpanPanelSkeleton = ({error, retry}: DynamicOptionsLoadingProps) =>
    error ? (
        <LoadError title="Couldn't load this panel" onRetry={retry} className="py-6" />
    ) : (
        <div className="flex flex-col gap-2 py-2" aria-hidden>
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-20 w-full" />
        </div>
    )
