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

const CustomNextStepProvider = ({children}: {children: React.ReactNode}) => {
    const onboardingSteps = useAtomValue(newOnboardingStateAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const userOnboardingJourneyStatus = useAtomValue(userOnboardingStatusAtom)
    const manualTrigger = useAtomValue(triggerOnboardingAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const {startNextStep} = useNextStep()
    const autoStartSignatureRef = useRef<string | null>(null)

    const previousSectionRef = useRef(userLocation.section)
    useEffect(() => {
        if (previousSectionRef.current !== userLocation.section) {
            setTriggerOnboarding(null)
            previousSectionRef.current = userLocation.section
        }
    }, [userLocation.section, setTriggerOnboarding])

    useEffect(() => {
        if (!isNewUser) {
            autoStartSignatureRef.current = null
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

        const sectionStatus = userOnboardingJourneyStatus[tourSection]
        if (sectionStatus === "done") return

        const signature = `${tourSection}:${currentTour.tour}:${currentTour.steps?.length ?? 0}`
        if (autoStartSignatureRef.current === signature) return

        autoStartSignatureRef.current = signature
        startNextStep(currentTour.tour)
    }, [isNewUser, userLocation.section, userOnboardingJourneyStatus, onboardingSteps])

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

    return (
        <NextStep steps={onboardingSteps} cardComponent={OnboardingCard} showNextStep={true}>
            {children}
        </NextStep>
    )
}

export default CustomNextStepProvider
