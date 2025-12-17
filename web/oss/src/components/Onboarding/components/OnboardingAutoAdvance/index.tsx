import {useEffect, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {useNextStep} from "nextstepjs"

import {
    onboardingStepsAtom,
    triggerOnboardingAtom,
    updateUserOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import type {OnboardingStep, UserOnboardingStatus} from "@/oss/state/onboarding/types"
import {urlLocationAtom} from "@/oss/state/url"

const OnboardingAutoAdvance = () => {
    const onboardingTours = useAtomValue(onboardingStepsAtom)
    const updateUserOnboardingStatus = useSetAtom(updateUserOnboardingStatusAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const userLocation = useAtomValue(urlLocationAtom)
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

    const resolvedSectionFromLocation = useMemo(
        () => userLocation.resolvedSection ?? userLocation.section,
        [userLocation.resolvedSection, userLocation.section],
    )

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
                const resolvedSection =
                    (activeStep?.onboardingSection as keyof UserOnboardingStatus | undefined) ??
                    resolvedSectionFromLocation
                if (resolvedSection) {
                    updateUserOnboardingStatus({section: resolvedSection, status: "done"})
                }
                setTriggerOnboarding(null)
                closeNextStep()
                return
            }

            setCurrentStep(currentStep + 1)
        }

        document.addEventListener("click", handleClick, true)
        return () => {
            document.removeEventListener("click", handleClick, true)
        }
    }, [
        activeStep,
        currentStep,
        totalSteps,
        isNextStepVisible,
        closeNextStep,
        setCurrentStep,
        resolvedSectionFromLocation,
        setTriggerOnboarding,
        updateUserOnboardingStatus,
    ])

    return null
}

export default OnboardingAutoAdvance
