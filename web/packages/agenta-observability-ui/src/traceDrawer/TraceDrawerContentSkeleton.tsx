import {LoadError} from "@agenta/ui/components/presentational"
import type {DynamicOptionsLoadingProps} from "next/dynamic"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

/**
 * The drawer body while its code loads on the first open. It keeps the header row of
 * `TraceDrawerContent`, so the content replaces it without a shift. If the code fails to load,
 * it offers a retry instead of loading forever.
 */
const TraceDrawerContentSkeleton = ({error, retry}: DynamicOptionsLoadingProps) =>
    error ? (
        <LoadError title="Couldn't load the trace" onRetry={retry} />
    ) : (
        <div className="h-full w-full flex flex-col" role="status" aria-label="Loading trace">
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-colorSplit">
                <SkeletonBlock className="h-6 max-w-[240px]" />
            </div>
            <div className="flex flex-col gap-3 p-4">
                <SkeletonBlock className="max-w-[320px]" />
                <SkeletonBlock className="h-24 max-w-none" />
                <SkeletonBlock className="h-24 max-w-none" />
            </div>
        </div>
    )

export default TraceDrawerContentSkeleton
