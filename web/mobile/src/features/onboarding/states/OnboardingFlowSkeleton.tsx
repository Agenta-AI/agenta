import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentaLogo} from "@/components/AgentaLogo"

import {ONBOARDING_COPY} from "../onboardingCopy"

const CHIP_WIDTHS = ["w-32", "w-24", "w-24", "w-20", "w-28", "w-40", "w-28", "w-24", "w-20"]

/** The flow's frame and first question while the draft agent is minted. */
export const OnboardingFlowSkeleton = () => (
    <main
        role="status"
        aria-label={ONBOARDING_COPY.preparing}
        className="bg-background text-foreground flex h-dvh flex-col"
    >
        <header className="mx-auto flex h-16 w-full max-w-[1040px] items-center gap-2 px-4 lg:h-[72px] lg:px-6">
            <span className="size-control-sm" />
            <AgentaLogo className="h-5 w-auto" />
            <SkeletonBlock className="ml-auto h-1.5 w-14 rounded-full" />
        </header>
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7 px-4 pt-6 lg:pt-[calc(10vh+2.5rem)]">
            <div className="flex flex-col gap-2">
                <SkeletonBlock className="h-8 w-2/3 lg:h-9" />
                <SkeletonBlock className="h-4 w-1/2" />
            </div>
            <div className="flex flex-wrap gap-2">
                {CHIP_WIDTHS.map((width, index) => (
                    <SkeletonBlock key={index} className={`h-11 rounded-lg ${width}`} />
                ))}
            </div>
        </div>
    </main>
)
