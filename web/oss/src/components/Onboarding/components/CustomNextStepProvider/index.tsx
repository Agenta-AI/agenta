import {
    isNewUserAtom,
    onboardingStepsAtom,
    triggerOnboardingAtom,
    userOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"
import {useAtomValue, useSetAtom} from "jotai"
import {NextStep, useNextStep} from "nextstepjs"
import {useEffect, useRef} from "react"
import OnboardingCard from "../../index"
import OnboardingAutoAdvance from "../OnboardingAutoAdvance"

const CustomNextStepProvider = ({children}: {children: React.ReactNode}) => {
    const onboardingSteps = useAtomValue(onboardingStepsAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const userOnboardingJourneyStatus = useAtomValue(userOnboardingStatusAtom)
    const manualTrigger = useAtomValue(triggerOnboardingAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const {startNextStep} = useNextStep()
    const autoStartSignatureRef = useRef<string | null>(null)

    const previousSectionRef = useRef(userLocation.resolvedSection ?? userLocation.section)
    useEffect(() => {
        const resolvedSection = userLocation.resolvedSection ?? userLocation.section
        if (previousSectionRef.current !== resolvedSection) {
            previousSectionRef.current = resolvedSection
            if (!manualTrigger) {
                setTriggerOnboarding(null)
            }
        }
    }, [userLocation.resolvedSection, userLocation.section, manualTrigger, setTriggerOnboarding])

    useEffect(() => {
        if (!isNewUser) {
            autoStartSignatureRef.current = null
            return
        }

        const normalizedSection = userLocation.resolvedSection
        if (!normalizedSection) {
            autoStartSignatureRef.current = null
            return
        }

        if (!onboardingSteps?.length) {
            autoStartSignatureRef.current = null
            return
        }

        const currentTour = onboardingSteps[0]
        if (!currentTour?.tour) return

        const tourSection =
            (currentTour.steps?.find((step) => step?.onboardingSection)
                ?.onboardingSection as keyof typeof userOnboardingJourneyStatus) ??
            normalizedSection

        const signature = `${tourSection}:${currentTour.tour}:${currentTour.steps?.length ?? 0}`
        if (autoStartSignatureRef.current === signature) return

        autoStartSignatureRef.current = signature

        startNextStep(currentTour.tour)
    }, [
        isNewUser,
        userLocation.resolvedSection,
        userOnboardingJourneyStatus,
        onboardingSteps,
        startNextStep,
    ])

    const lastManualTriggerRef = useRef<typeof manualTrigger>(null)
    useEffect(() => {
        if (!manualTrigger) {
            lastManualTriggerRef.current = null
            return
        }
        if (!onboardingSteps?.length) return
        if (lastManualTriggerRef.current === manualTrigger) return

        lastManualTriggerRef.current = manualTrigger
        const targetTour =
            manualTrigger.tourId !== undefined
                ? (onboardingSteps.find((tour) => tour.tour === manualTrigger.tourId) ??
                  onboardingSteps[0])
                : onboardingSteps[0]
        const tourId = targetTour?.tour
        if (!tourId) return

        startNextStep(tourId)
    }, [manualTrigger, onboardingSteps, startNextStep])

    const handleComplete = () => {
        setTriggerOnboarding(null)
    }

    return (
        <NextStep
            steps={onboardingSteps}
            cardComponent={OnboardingCard}
            showNextStep={true}
            onComplete={handleComplete}
        >
            <OnboardingAutoAdvance />
            {children}
        </NextStep>
    )
}

export default CustomNextStepProvider
