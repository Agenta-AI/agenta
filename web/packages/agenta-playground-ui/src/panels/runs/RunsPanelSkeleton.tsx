import {SkeletonBlock} from "@agenta/ui/ui"

/** The run pane's loading shape: the header bar with its title, then two blocks. */
export const RunsPanelSkeleton = () => (
    <div data-testid="runs-panel-skeleton" className="w-full">
        <div className="flex h-12 items-center border-0 border-b border-solid border-border px-4">
            <SkeletonBlock className="h-6 w-[220px]" />
        </div>
        <div className="flex flex-col gap-3 p-4">
            <SkeletonBlock className="h-16 w-full" />
            <SkeletonBlock className="h-24 w-full" />
        </div>
    </div>
)
