import {SkeletonBlock} from "@agenta/ui/ui"

import {ONBOARDING_COPY} from "../onboardingCopy"
import {OnboardingHeader} from "../OnboardingHeader"

const CHIP_WIDTHS = ["w-32", "w-24", "w-24", "w-20", "w-28", "w-40", "w-28", "w-24", "w-20"]

/** The first question's frame while the draft agent is minted: the same header and column. */
export const OnboardingFlowSkeleton = () => (
    <main
        role="status"
        aria-label={ONBOARDING_COPY.preparing}
        className="bg-background text-foreground flex h-dvh flex-col"
    >
        <OnboardingHeader position={1} onBack={null} />
        <div className="flex-1 px-4 lg:px-6">
            <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7 pb-16 pt-6 lg:pt-[10vh]">
                <div className="flex flex-col gap-1.5">
                    <SkeletonBlock className="h-8 w-2/3 lg:h-9" />
                    <SkeletonBlock className="h-5 w-1/2" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {CHIP_WIDTHS.map((width, index) => (
                        <SkeletonBlock key={index} className={`h-11 rounded-lg ${width}`} />
                    ))}
                </div>
            </div>
        </div>
    </main>
)
