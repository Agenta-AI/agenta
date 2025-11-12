import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useCallback, useEffect, useState} from "react"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {
    isNewUserAtom,
    isNewUserStorageAtom,
    newOnboardingStateAtom,
    resolveOnboardingSection,
    triggerOnboardingAtom,
    updateUserOnboardingStatusAtom,
    userOnboardingStatusAtom,
} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"
import {WelcomeModalProps} from "../../types"

const WelcomeModalContent = dynamic(() => import("./assets/WelcomeModalContent"), {ssr: false})

const WelcomeModal = ({open, ...props}: WelcomeModalProps) => {
    const isNewUser = useAtomValue(isNewUserAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const userOnboardingJourneyStatus = useAtomValue(userOnboardingStatusAtom)
    const setTriggerOnboarding = useSetAtom(triggerOnboardingAtom)
    const updateOnboardingStatus = useSetAtom(updateUserOnboardingStatusAtom)

    const [isModalOpen, setIsModalOpen] = useState(false)

    useEffect(() => {
        if (!isNewUser) return

        const normalizedSection = resolveOnboardingSection(userLocation.section)
        if (!normalizedSection) return

        const sectionStatus = userOnboardingJourneyStatus[normalizedSection]
        if (sectionStatus !== "idle") return

        setIsModalOpen(true)
    }, [isNewUser, userLocation, userOnboardingJourneyStatus])

    const onSkip = useCallback(() => {
        updateOnboardingStatus({section: "apps", status: "skipped"})
        setIsModalOpen(false)
    }, [updateOnboardingStatus])

    const onStartTour = useCallback(() => {
        setTriggerOnboarding({state: "apps"})
        setIsModalOpen(false)
    }, [setTriggerOnboarding])

    return (
        <EnhancedModal
            open={isModalOpen}
            okText="Create your first app"
            cancelText="Skip tour"
            okButtonProps={{type: "primary", onClick: onStartTour}}
            cancelButtonProps={{type: "default", onClick: onSkip}}
            maskClosable={false}
            closable={false}
            width={720}
            title="Welcome to Agenta 👋"
            onCancel={onSkip}
            {...props}
        >
            <WelcomeModalContent />
        </EnhancedModal>
    )
}

export default WelcomeModal
