import {ConfigPanelSkeleton} from "@agenta/playground-ui/panels/config"
import {SkeletonBlock} from "@agenta/ui/ui"

/**
 * The playground while it loads, in the final layout: the top bar, the config pane with its
 * header bar, and the run pane. On a phone only the config pane shows, as on the loaded page.
 */
export const PlaygroundSkeleton = () => (
    <div data-testid="playground-skeleton" className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <SkeletonBlock className="h-4 w-32" />
        </div>
        <div className="flex min-h-0 flex-1">
            <div className="flex w-full flex-col md:w-1/2 md:border-r md:border-border">
                <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
                    <SkeletonBlock className="h-4 w-40" />
                </div>
                <ConfigPanelSkeleton />
            </div>
            <div className="hidden flex-1 p-4 md:block">
                <SkeletonBlock className="h-full w-full" />
            </div>
        </div>
    </div>
)
