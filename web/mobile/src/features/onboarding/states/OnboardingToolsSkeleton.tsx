import {SkeletonBlock} from "@agenta/ui/ui"

/** The app grid while the catalog loads: the same cards, without names. */
export const OnboardingToolsSkeleton = () => (
    <div aria-busy className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({length: 6}, (_, index) => (
            <SkeletonBlock key={index} className="h-[58px] rounded-xl" />
        ))}
    </div>
)
