import {SkeletonBlock} from "@agenta/ui/ui"

import {ONBOARDING_COPY} from "../onboardingCopy"
import {OnboardingHeader} from "../OnboardingHeader"

const CHIP_WIDTHS = ["w-32", "w-24", "w-24", "w-20", "w-28", "w-40", "w-28", "w-24", "w-20"]

/** The first question's frame while the draft agent is minted: the same header and column. */
export const OnboardingFlowSkeleton = () => (
    <div
        role="status"
        aria-label={ONBOARDING_COPY.preparing}
        className="bg-background text-foreground flex h-dvh flex-col"
    >
        <OnboardingHeader />
        <div className="flex flex-1 items-center justify-center px-4 pb-24 pt-6 sm:px-6">
            <div className="flex w-full max-w-[680px] flex-col gap-7">
                <div className="flex flex-col gap-1.5">
                    <SkeletonBlock className="h-[34px] w-2/3 sm:h-10" />
                    <SkeletonBlock className="h-[22px] w-1/2" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {CHIP_WIDTHS.map((width, index) => (
                        <SkeletonBlock key={index} className={`h-[42px] rounded-lg ${width}`} />
                    ))}
                </div>
            </div>
        </div>
    </div>
)
