import {SkeletonBlock} from "@agenta/ui/ui"

/** A tab's body while its code loads: list rows in the page's own rhythm. */
export const SettingsTabSkeleton = () => (
    <div className="flex flex-col" role="status" aria-label="Loading">
        {Array.from({length: 6}, (_, index) => (
            <div
                key={index}
                className="flex items-center gap-3 border-0 border-b border-solid border-border/40 py-3.5"
            >
                <SkeletonBlock active className="size-7 shrink-0 rounded-[6px]" />
                <div className="flex flex-1 flex-col gap-1.5">
                    <SkeletonBlock active className="h-4 w-1/3 rounded" />
                    <SkeletonBlock active className="h-3.5 w-1/2 rounded" />
                </div>
            </div>
        ))}
    </div>
)
