import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {
    isNewUserAtom,
    isNewUserStorageAtom,
    newOnboardingStateAtom,
    resolveOnboardingSection,
    triggerOnboardingAtom,
    updateUserOnboardingStatusAtom,
    userOnboardingStatusAtom,
    userOnboardingProfileContextAtom,
} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import {createOnlineEvaluation, redirectToAppsPage} from "@/oss/state/onboarding/assets/utils"
import {
    demoOnlineEvaluationAtom,
    fullJourneyStateAtom,
} from "@/oss/state/onboarding/atoms/helperAtom"
import {WelcomeModalProps} from "../../types"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

const WelcomeModalContent = dynamic(() => import("./assets/WelcomeModalContent"), {ssr: false})

const WelcomeModal = ({open, ...props}: WelcomeModalProps) => {
    const isNewUser = useAtomValue(isNewUserAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const userOnboardingJourneyStatus = useAtomValue(userOnboardingStatusAtom)
    const userProfile = useAtomValue(userOnboardingProfileContextAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const updateOnboardingStatus = useSetAtom(updateUserOnboardingStatusAtom)
    const setDemoEvaluationContext = useSetAtom(demoOnlineEvaluationAtom)
    const setLastVisitedEvaluation = useSetAtom(lastVisitedEvaluationAtom)
    const setFullJourneyState = useSetAtom(fullJourneyStateAtom)
    const posthog = usePostHogAg()

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isStartingTour, setIsStartingTour] = useState(false)

    const isSme = useMemo(() => {
        const role = userProfile?.userRole?.trim().toLowerCase()
        return role === "sme"
    }, [userProfile?.userRole])

    useEffect(() => {
        if (!isNewUser) return

        const normalizedSection = resolveOnboardingSection(userLocation.section)
        if (!normalizedSection) return

        const fullJourneyStatus = userOnboardingJourneyStatus.fullJourney
        if (fullJourneyStatus && fullJourneyStatus !== "idle") return

        const sectionStatus = userOnboardingJourneyStatus[normalizedSection]
        if (sectionStatus !== "idle") return

        setIsModalOpen(true)
        posthog?.capture("onboarding_welcome_action", {
            action: "visible",
        })
    }, [isNewUser, userLocation, userOnboardingJourneyStatus, posthog, isSme])

    const onSkip = useCallback(() => {
        if (isStartingTour) return
        posthog?.capture("onboarding_welcome_action", {
            action: "skip",
        })
        updateOnboardingStatus({section: "apps", status: "skipped"})
        setFullJourneyState({active: false, state: null, journeyId: null})
        updateOnboardingStatus({section: "fullJourney", status: "skipped"})
        setIsModalOpen(false)
    }, [isStartingTour, updateOnboardingStatus, setFullJourneyState, posthog, isSme])

    const onStartTour = useCallback(async () => {
        posthog?.capture("onboarding_welcome_action", {
            action: "start",
        })
        updateOnboardingStatus({section: "apps", status: "started"})

        if (!isSme) {
            setFullJourneyState({active: false, state: null, journeyId: null})
            setTriggerOnboarding({state: "apps"})
            setIsModalOpen(false)
            return
        }

        try {
            setIsStartingTour(true)
            const context = await createOnlineEvaluation()
            setDemoEvaluationContext(context)
            setLastVisitedEvaluation("online_evaluation")
            await redirectToAppsPage()
            setFullJourneyState({active: true, state: "apps", journeyId: "sme-guided-journey"})
            setTriggerOnboarding({state: "apps"})
            setIsModalOpen(false)
        } catch (error) {
            console.error("[WelcomeModal] SME onboarding start failed", error)
            const err = error as Error
            message.error(err?.message || "Failed to create the demo evaluation. Try again.")
        } finally {
            setIsStartingTour(false)
        }
    }, [
        isSme,
        updateOnboardingStatus,
        setDemoEvaluationContext,
        setLastVisitedEvaluation,
        setTriggerOnboarding,
        setFullJourneyState,
        posthog,
    ])

    return (
        <EnhancedModal
            open={isModalOpen}
            okText={isSme ? "Start tour" : "Create your first app"}
            cancelText="Skip tour"
            okButtonProps={{type: "primary", onClick: onStartTour, loading: isStartingTour}}
            cancelButtonProps={{type: "default", onClick: onSkip, disabled: isStartingTour}}
            maskClosable={false}
            closable={false}
            width={720}
            title="Welcome to Agenta 👋"
            onCancel={onSkip}
            {...props}
        >
            <WelcomeModalContent variant={isSme ? "sme" : "default"} />
        </EnhancedModal>
    )
}

export default WelcomeModal
