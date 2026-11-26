import {useT} from "@agenta/i18n"
import flowCatalog from "@agenta/i18n/catalogs/onboarding.flow"
import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import type {OnboardingStep} from "./onboardingRoute"
import {useQuestionText} from "./useQuestionText"

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
    const t = useT(flowCatalog)
    const questionText = useQuestionText()
    const dotLabel = (step: OnboardingStep) =>
        questionText.dot(step) ??
        (step === "credits" ? t("onboarding.flow.dotCredits") : t("onboarding.flow.dotTemplates"))
    return (
        <nav
            aria-label={t("onboarding.flow.stepCounter", {
                current: current + 1,
                total: steps.length,
            })}
            // In the page's flow at every size, on the page background, so it never covers content.
            className="bg-background flex shrink-0 items-center justify-center gap-0.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-8 md:pt-6"
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
