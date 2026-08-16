import {useCallback, useState, type ReactNode} from "react"

import clsx from "clsx"

import {AutoRefreshControl} from "./AutoRefreshControl"
import {useToolbarFilterSync} from "./filterControls"
import {RealtimeModeControl} from "./RealtimeModeControl"
import {DeleteTracesButton, ExportButton, RefreshButton} from "./ToolbarButtons"
import {ToolbarSearch} from "./ToolbarSearch"
import {TraceTabsControl} from "./TraceTabsControl"

export interface ObservabilityToolbarProps {
    /** Which surface the toolbar sits above — decides the second row entirely. */
    componentType: "traces" | "sessions"
    isLoading?: boolean
    /** The host's refresh. It owns what "refresh" means (refetch, page reset, cache invalidation). */
    onRefresh: () => void | Promise<void>
    /** Host-driven refresh tick; falls back to the toolbar's own counter when omitted. */
    refreshTrigger?: number
    /**
     * The export pipeline (file picker, adaptive fetcher, CSV writer, toasts) stays in the host.
     * Omit to hide the button — that is how the export permission gate is expressed.
     */
    onExport?: () => void
    isExporting?: boolean
    /** Delete-modal wiring stays in the host. Omit to hide the button. */
    onDelete?: () => void
    /** The filter dialog. */
    filtersSlot?: ReactNode
    /** The time-range / sort picker. */
    sortSlot?: ReactNode
    /** Trailing actions on the traces row — OSS passes its add-to-testset / add-to-queue menu. */
    actionsSlot?: ReactNode
    className?: string
}

/**
 * The chrome above the observability and sessions tables. Everything it renders itself reads its
 * own state from `@agenta/observability`; everything that needs app wiring is a slot or a
 * callback.
 */
export const ObservabilityToolbar = ({
    componentType,
    isLoading,
    onRefresh,
    refreshTrigger,
    onExport,
    isExporting,
    onDelete,
    filtersSlot,
    sortSlot,
    actionsSlot,
    className,
}: ObservabilityToolbarProps) => {
    const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0)

    useToolbarFilterSync()

    const handleRefresh = useCallback(async () => {
        await onRefresh()
        setInternalRefreshTrigger((prev) => prev + 1)
    }, [onRefresh])

    const effectiveRefreshTrigger = refreshTrigger ?? internalRefreshTrigger

    return (
        <section className={clsx("flex justify-between gap-2 flex-col", className)}>
            <div className="w-full flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1">
                    <RefreshButton isLoading={isLoading} onClick={handleRefresh} />
                    <ToolbarSearch />
                    {filtersSlot}
                    {sortSlot}
                    <AutoRefreshControl resetTrigger={effectiveRefreshTrigger} />
                </div>
            </div>

            {componentType === "traces" ? (
                <div className="w-full flex items-center justify-between">
                    <TraceTabsControl />
                    <div className="flex items-center gap-2">
                        {onExport ? (
                            <ExportButton isExporting={isExporting} onClick={onExport} />
                        ) : null}
                        {onDelete ? <DeleteTracesButton onClick={onDelete} /> : null}
                        {actionsSlot}
                    </div>
                </div>
            ) : null}

            {componentType === "sessions" ? (
                <div className="w-full flex items-center justify-end">
                    <RealtimeModeControl />
                </div>
            ) : null}
        </section>
    )
}

export default ObservabilityToolbar
