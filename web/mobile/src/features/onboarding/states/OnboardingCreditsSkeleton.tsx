import {SkeletonBlock} from "@agenta/ui/ui"

/** The wallet card and the ways-to-pay panel while the model connections resolve. */
export const OnboardingCreditsSkeleton = () => (
    <div aria-busy className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,304px)_minmax(0,1fr)]">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-4 w-24 max-sm:hidden" />
        <SkeletonBlock className="aspect-[1.586] rounded-2xl" />
        <SkeletonBlock className="min-h-48 rounded-xl" />
    </div>
)
