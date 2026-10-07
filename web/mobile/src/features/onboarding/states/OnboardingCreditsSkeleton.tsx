import {SkeletonBlock} from "@agenta/ui/ui"

/** The ways to pay while the deployment's model connections resolve. */
export const OnboardingCreditsSkeleton = () => (
    <div aria-busy className="flex flex-col gap-2">
        {Array.from({length: 3}, (_, index) => (
            <SkeletonBlock key={index} className="h-[76px] rounded-xl" />
        ))}
    </div>
)
