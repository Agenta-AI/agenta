import {SkeletonBlock} from "@agenta/ui/ui"

/** Mirrors Plan & billing: the plan and credits cards, the limit tiles, then payments. */
export const BillingPageSkeleton = () => (
    <div className="flex flex-col gap-10" aria-busy="true">
        <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1.2fr_1fr]">
                <SkeletonBlock className="h-[176px] rounded-xl" />
                <SkeletonBlock className="h-[176px] rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                {Array.from({length: 4}, (_, index) => (
                    <SkeletonBlock key={index} className="h-[108px] rounded-xl" />
                ))}
            </div>
        </div>
        <SkeletonBlock className="h-24 rounded-xl" />
    </div>
)
