import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import {AgentaLogo} from "@/components/AgentaLogo"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {PROGRESS_TOTAL} from "./onboardingDraft"

/** The flow's top bar: back, the wordmark, and where the user is in the four steps. */
export const OnboardingHeader = ({
    position,
    onBack,
}: {
    position: number
    /** `null` on the first step, which has nothing behind it. */
    onBack: (() => void) | null
}) => {
    const label = ONBOARDING_COPY.stepCounter(position, PROGRESS_TOTAL)
    return (
        <header className="bg-background/90 sticky top-0 z-10 backdrop-blur-sm">
            <div className="mx-auto flex h-16 w-full max-w-[1040px] items-center gap-2 px-4 lg:h-[72px] lg:px-6">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={ONBOARDING_COPY.back}
                    onClick={onBack ?? undefined}
                    disabled={!onBack}
                    className={cn(!onBack && "invisible")}
                >
                    <ArrowLeft />
                </Button>
                <AgentaLogo className="h-5 w-auto" />
                <div className="ml-auto flex items-center gap-3">
                    <span className="text-muted-foreground text-xs max-sm:hidden">{label}</span>
                    <div
                        role="progressbar"
                        aria-valuemin={1}
                        aria-valuemax={PROGRESS_TOTAL}
                        aria-valuenow={position}
                        aria-label={label}
                        className="flex items-center gap-1"
                    >
                        {Array.from({length: PROGRESS_TOTAL}, (_, index) => (
                            <span
                                key={index}
                                className={cn(
                                    "h-1.5 rounded-full transition-colors",
                                    index + 1 === position
                                        ? "bg-foreground w-5"
                                        : index + 1 < position
                                          ? "bg-muted-foreground w-1.5"
                                          : "bg-border w-1.5",
                                )}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </header>
    )
}
