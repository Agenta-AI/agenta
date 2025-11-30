import {useEffect, useMemo} from "react"
import {useAtomValue} from "jotai"
import {useNextStep} from "nextstepjs"

import {onboardingStepsAtom} from "@/oss/state/onboarding"
import type {OnboardingStep} from "@/oss/state/onboarding/types"

const OnboardingAutoAdvance = () => {
    const onboardingTours = useAtomValue(onboardingStepsAtom)
    const {currentTour, currentStep, isNextStepVisible, setCurrentStep, closeNextStep} =
        useNextStep()

    const {activeStep, totalSteps} = useMemo(() => {
        if (!currentTour) {
            return {activeStep: null, totalSteps: 0}
        }

        const matchingTour = onboardingTours.find((tour) => tour.tour === currentTour)
        if (!matchingTour) {
            return {activeStep: null, totalSteps: 0}
        }

        const step = matchingTour.steps[currentStep] as OnboardingStep | undefined
        return {activeStep: step ?? null, totalSteps: matchingTour.steps.length}
    }, [currentTour, currentStep, onboardingTours])

    useEffect(() => {
        if (!activeStep?.advanceOnClick || !activeStep.selector || !isNextStepVisible) {
            return
        }

        const handleClick = async (event: MouseEvent) => {
            if (!activeStep.selector) return

            const target = event.target
            if (!(target instanceof Element)) return

            const matchedTarget = target.closest(activeStep.selector)
            if (!matchedTarget) {
                return
            }

            try {
                await activeStep.onNext?.()
            } catch (error) {
                console.error("Failed to run onboarding advance handler", error)
            }

            if (currentStep >= totalSteps - 1) {
                closeNextStep()
                return
            }

            setCurrentStep(currentStep + 1)
        }

        document.addEventListener("click", handleClick, true)
        return () => {
            document.removeEventListener("click", handleClick, true)
        }
    }, [activeStep, currentStep, totalSteps, isNextStepVisible, closeNextStep, setCurrentStep])

    return null
}

export default OnboardingAutoAdvance
