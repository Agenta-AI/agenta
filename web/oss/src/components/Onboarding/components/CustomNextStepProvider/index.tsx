import {
    newOnboardingStateAtom,
    isNewUserAtom,
    userOnboardingStatusAtom,
    resolveOnboardingSection,
    triggerOnboardingAtom,
} from "@/oss/state/onboarding"
import {useAtomValue, useSetAtom} from "jotai"
import {NextStep} from "nextstepjs"
import OnboardingCard from "../../index"
import {urlLocationAtom} from "@/oss/state/url"
import {useEffect, useRef} from "react"
import {useNextStep} from "nextstepjs"
import {fullJourneyStateAtom} from "@/oss/state/onboarding/atoms/helperAtom"

const CustomNextStepProvider = ({children}: {children: React.ReactNode}) => {
    const onboardingSteps = useAtomValue(newOnboardingStateAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const userOnboardingJourneyStatus = useAtomValue(userOnboardingStatusAtom)
    const manualTrigger = useAtomValue(triggerOnboardingAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const fullJourneyState = useAtomValue(fullJourneyStateAtom)
    const setFullJourneyState = useSetAtom(fullJourneyStateAtom)
    const {startNextStep} = useNextStep()
    const autoStartSignatureRef = useRef<string | null>(null)

    const previousSectionRef = useRef(userLocation.section)
    useEffect(() => {
        if (previousSectionRef.current !== userLocation.section) {
            previousSectionRef.current = userLocation.section
            if (!manualTrigger && !fullJourneyState.active) {
                setTriggerOnboarding(null)
            }
        }
    }, [userLocation.section, manualTrigger, fullJourneyState.active])

    useEffect(() => {
        if (!isNewUser) {
            autoStartSignatureRef.current = null
            return
        }

        if (fullJourneyState.active) {
            return
        }

        const normalizedSection = resolveOnboardingSection(userLocation.section)
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
        userLocation.section,
        userOnboardingJourneyStatus,
        onboardingSteps,
        fullJourneyState.active,
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
        startNextStep(onboardingSteps[0]?.tour)
    }, [manualTrigger, onboardingSteps, startNextStep])

    const handleComplete = () => {
        setTriggerOnboarding(null)
        if (fullJourneyState.active) {
            setFullJourneyState({active: false, state: null, journeyId: null})
        }
    }

    return (
        <NextStep
            steps={onboardingSteps}
            cardComponent={OnboardingCard}
            showNextStep={true}
            onComplete={handleComplete}
        >
            {children}
        </NextStep>
    )
}

export default CustomNextStepProvider
