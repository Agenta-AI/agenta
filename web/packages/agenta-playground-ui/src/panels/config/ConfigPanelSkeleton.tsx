import {SkeletonBlock} from "@agenta/ui/ui"

/** The config editor's loading shape: one field bar, then a prompt block and a smaller one. */
export const ConfigPanelSkeleton = () => (
    <div data-testid="config-panel-skeleton" className="flex flex-col gap-3 px-4 py-3">
        <SkeletonBlock className="h-9 w-full" />
        <SkeletonBlock className="h-32 w-full" />
        <SkeletonBlock className="h-24 w-full" />
    </div>
)
