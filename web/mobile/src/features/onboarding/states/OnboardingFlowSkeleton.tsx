import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentaLogo} from "@/components/AgentaLogo"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** The flow's frame while the variant resolves and the draft agent is minted. */
export const OnboardingFlowSkeleton = () => (
    <main
        role="status"
        aria-label={ONBOARDING_COPY.preparing}
        className="bg-background text-foreground flex h-dvh flex-col"
    >
        <header className="mx-auto w-full max-w-[1200px] px-4 pt-6 lg:px-8 lg:pt-8">
            <div className="flex items-center justify-between">
                <AgentaLogo className="h-6 w-auto" />
                <SkeletonBlock className="h-4 w-20" />
            </div>
            <SkeletonBlock className="mt-5 h-[3px] w-full rounded-full" />
        </header>
        <div className="mx-auto flex w-full max-w-[700px] flex-col items-center gap-3 px-4 pt-10 lg:pt-16">
            <SkeletonBlock className="h-8 w-2/3 lg:h-9" />
            <SkeletonBlock className="mb-5 h-4 w-1/2" />
            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3">
                {Array.from({length: 6}, (_, index) => (
                    <SkeletonBlock key={index} className="h-[108px] rounded-xl lg:h-[124px]" />
                ))}
            </div>
        </div>
    </main>
)
