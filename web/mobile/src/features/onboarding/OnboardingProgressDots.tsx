import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {onboardingQuestion} from "./onboardingQuestions"
import type {OnboardingStep} from "./onboardingRoute"

const dotLabel = (step: OnboardingStep) =>
    onboardingQuestion(step)?.dot ?? ONBOARDING_COPY.dots[step as keyof typeof ONBOARDING_COPY.dots]

/** One dot per shown step; a reached dot jumps back to its step. */
export const OnboardingProgressDots = ({
    steps,
    current,
    reached,
    onGo,
}: {
    steps: readonly OnboardingStep[]
    /** Index of the current dot. */
    current: number
    /** Whether a dot's step can be opened from here. */
    reached: (step: OnboardingStep) => boolean
    onGo: (step: OnboardingStep) => void
}) => {
    const {stepTransition} = useMotionPresets()
    return (
        <nav
            aria-label={ONBOARDING_COPY.stepCounter(current + 1, steps.length)}
            // In the page's flow on a phone, so it never covers content; fixed at the foot from md.
            className="flex shrink-0 items-center justify-center gap-0.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:fixed md:bottom-8 md:left-1/2 md:z-20 md:-translate-x-1/2 md:pb-0"
        >
            {steps.map((step, index) => {
                const open = reached(step)
                return (
                    <button
                        type="button"
                        key={step}
                        disabled={!open}
                        aria-current={index === current ? "step" : undefined}
                        aria-label={dotLabel(step)}
                        title={dotLabel(step)}
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
