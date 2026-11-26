import {SkeletonBlock} from "@agenta/ui/ui"

/** The drawer body while the traces load: a tree column and two trace panels, without text. */
export const SessionDrawerSkeleton = ({narrow}: {narrow: boolean}) => (
    <div className="flex min-h-0 flex-1" aria-hidden>
        {narrow ? null : (
            <div className="flex w-[320px] shrink-0 flex-col gap-3 border-0 border-r border-solid border-border p-4">
                <SkeletonBlock className="h-8 w-full" />
                {Array.from({length: 6}, (_, index) => (
                    <SkeletonBlock key={index} className="h-5 w-full" />
                ))}
            </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
            <SkeletonBlock className="h-6 w-1/2" />
            <SkeletonBlock className="h-40 w-full" />
            <SkeletonBlock className="h-40 w-full" />
        </div>
    </div>
)
