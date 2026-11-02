import {SkeletonBlock} from "@agenta/ui/ui"

/** Mirrors the Credits page: the wallet card and its tiles, then the usage chart. */
export const CreditsPageSkeleton = () => (
    <div className="flex flex-col gap-11" aria-busy="true">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <SkeletonBlock className="h-[140px] rounded-2xl" />
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                {Array.from({length: 2}, (_, index) => (
                    <SkeletonBlock key={index} className="h-[140px] rounded-xl" />
                ))}
            </div>
        </div>
        <div className="flex flex-col gap-4">
            <SkeletonBlock className="h-7 w-24" />
            <SkeletonBlock className="h-[320px] rounded-xl" />
        </div>
    </div>
)
