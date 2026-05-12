import {useCallback, useEffect, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {welcomeCardsDismissedAtom} from "@/oss/components/pages/app-management/components/WelcomeCardsSection/assets/store/welcomeCards"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {StyleProps} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"

import {useStyles} from "./assets/styles"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import WelcomeCardsSection from "./components/WelcomeCardsSection"

const CreateAppTypeModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/CreateAppTypeModal"),
)

const SetupTracingModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/SetupTracingModal"),
)

const ObservabilityDashboardSection: any = dynamic(
    () => import("@/oss/components/pages/app-management/components/ObservabilityDashboardSection"),
)

const AppManagement: React.FC = () => {
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const welcomeCardsDismissed = useAtomValue(welcomeCardsDismissedAtom)
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isCreateAppTypeModalOpen, setIsCreateAppTypeModalOpen] = useState(false)
    const [isSetupTracingModal, setIsSetupTracingModal] = useState(false)
    const {error} = useAppsData()

    // Pre-fetch the catalog templates on page mount so the welcome-card
    // "Create a prompt" shortcut and the apps-table dropdown both have
    // data ready. This avoids the first-click latency cliff when the
    // factory falls back to a synchronous fetch.
    useAtomValue(appTemplatesQueryAtom)

    /**
     * "Create a prompt" welcome-card shortcut: opens the CreateAppTypeModal
     * so the user explicitly picks Chat or Completion before we mint the
     * ephemeral app. The modal handles drawer navigation; we only own
     * opening the modal here.
     */
    const handleCreatePrompt = useCallback(() => {
        setIsCreateAppTypeModalOpen(true)
    }, [])

    useEffect(() => {
        if (onboardingWidgetActivation !== "open-create-prompt") return
        handleCreatePrompt()
        setOnboardingWidgetActivation(null)
    }, [handleCreatePrompt, onboardingWidgetActivation, setOnboardingWidgetActivation])

    useEffect(() => {
        if (onboardingWidgetActivation !== "tracing-snippet") return
        setIsSetupTracingModal(true)
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setOnboardingWidgetActivation])

    return (
        <>
            <PageLayout className={`${classes.container} gap-8`}>
                {error ? (
                    <ResultComponent status={"error"} title="Failed to load" />
                ) : (
                    <>
                        {welcomeCardsDismissed && (
                            <Typography.Title level={5} className="!m-0">
                                Home
                            </Typography.Title>
                        )}

                        <WelcomeCardsSection
                            onCreatePrompt={handleCreatePrompt}
                            onSetupTracing={() => setIsSetupTracingModal(true)}
                        />

                        <ObservabilityDashboardSection />

                        <ApplicationManagementSection />

                        <HelpAndSupportSection />
                    </>
                )}
            </PageLayout>

            <SetupTracingModal
                open={isSetupTracingModal}
                onCancel={() => setIsSetupTracingModal(false)}
            />

            <CreateAppTypeModal
                open={isCreateAppTypeModalOpen}
                onCancel={() => setIsCreateAppTypeModalOpen(false)}
            />
        </>
    )
}

export default AppManagement
