import {SkeletonBlock} from "@agenta/ui/ui"

/** The model options while the deployment's candidates resolve. */
export const OnboardingModelSkeleton = () => (
    <div aria-busy className="flex flex-col gap-3">
        <SkeletonBlock className="h-[72px] rounded-xl" />
        <SkeletonBlock className="h-[72px] rounded-xl" />
        <SkeletonBlock className="h-[72px] rounded-xl" />
    </div>
)
