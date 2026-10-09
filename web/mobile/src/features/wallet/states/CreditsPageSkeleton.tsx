import {SkeletonBlock} from "@agenta/ui/ui"

/** Mirrors the Credits page: the wallet card and its tiles, then the usage chart. */
export const CreditsPageSkeleton = () => (
    <div className="flex flex-col gap-11" aria-busy="true">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <SkeletonBlock className="aspect-[1.586] rounded-2xl" />
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                {Array.from({length: 3}, (_, index) => (
                    <SkeletonBlock key={index} className="min-h-[120px] rounded-2xl" />
                ))}
            </div>
        </div>
        <div className="flex flex-col gap-4">
            <SkeletonBlock className="h-7 w-24" />
            <SkeletonBlock className="h-[320px] rounded-xl" />
        </div>
    </div>
)
