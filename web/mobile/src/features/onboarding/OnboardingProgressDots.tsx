import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {PROGRESS_STEPS, type OnboardingStep} from "./onboardingDraft"

/**
 * The four progress dots at the foot of the page. They are also the way back: a dot already
 * reached jumps to its step.
 */
export const OnboardingProgressDots = ({
    current,
    reached,
    onGo,
}: {
    /** Index of the current dot. */
    current: number
    /** Whether a dot's step can be opened from here. */
    reached: (step: OnboardingStep) => boolean
    onGo: (step: OnboardingStep) => void
}) => {
    const {stepTransition} = useMotionPresets()
    return (
        <nav
            aria-label={ONBOARDING_COPY.stepCounter(current + 1, PROGRESS_STEPS.length)}
            className="fixed bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5"
        >
            {PROGRESS_STEPS.map((step, index) => {
                const open = reached(step)
                return (
                    <button
                        type="button"
                        key={step}
                        disabled={!open}
                        aria-current={index === current ? "step" : undefined}
                        aria-label={ONBOARDING_COPY.dots[step]}
                        title={ONBOARDING_COPY.dots[step]}
                        onClick={() => onGo(step)}
                        className="inline-flex h-5 items-center border-0 bg-transparent px-0.5 enabled:cursor-pointer disabled:cursor-default"
                    >
                        <motion.span
                            initial={false}
                            animate={{width: index === current ? 22 : 6}}
                            transition={stepTransition}
                            className={cn(
                                "block h-1.5 rounded-full transition-colors motion-reduce:transition-none",
                                index === current
                                    ? "bg-foreground"
                                    : index < current
                                      ? "bg-muted-foreground"
                                      : "bg-border",
                            )}
                        />
                    </button>
                )
            })}
        </nav>
    )
}
