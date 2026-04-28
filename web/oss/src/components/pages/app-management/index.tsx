import {useCallback, useEffect, useState} from "react"

import {appTemplatesQueryAtom, createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {PageLayout} from "@agenta/ui"
import {Typography, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {welcomeCardsDismissedAtom} from "@/oss/components/pages/app-management/components/WelcomeCardsSection/assets/store/welcomeCards"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import useURL from "@/oss/hooks/useURL"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {StyleProps} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {useOrgData} from "@/oss/state/org"

import {useStyles} from "./assets/styles"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import WelcomeCardsSection from "./components/WelcomeCardsSection"

const MaxAppModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/MaxAppModal"),
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
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [isSetupTracingModal, setIsSetupTracingModal] = useState(false)
    const {error} = useAppsData()
    const {selectedOrg} = useOrgData()

    const router = useRouter()
    const {baseAppURL} = useURL()
    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)

    // Pre-fetch the catalog templates on page mount so the welcome-card
    // "Create a prompt" shortcut and the apps-table dropdown both have
    // data ready. This avoids the first-click latency cliff when the
    // factory falls back to a synchronous fetch.
    useAtomValue(appTemplatesQueryAtom)

    /**
     * "Create a prompt" welcome-card shortcut: defaults to a Chat app
     * (the most common case). Users who want Completion / Custom go through
     * the dropdown next to the apps table for full type selection.
     */
    const handleCreatePrompt = useCallback(async () => {
        const entityId = await createEphemeralAppFromTemplate({type: "chat"})
        if (!entityId) {
            message.error("Couldn't start app creation — please retry")
            return
        }
        setOpenDrawer({
            entityId,
            context: "app-create",
            onWorkflowCreated: ({newAppId, newRevisionId} = {}) => {
                if (!newAppId || !newRevisionId) return
                router.push(`${baseAppURL}/${newAppId}/playground?revisions=${newRevisionId}`)
            },
        })
    }, [baseAppURL, router, setOpenDrawer])

    useEffect(() => {
        if (onboardingWidgetActivation !== "open-create-prompt") return
        void handleCreatePrompt()
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

                        <ApplicationManagementSection
                            selectedOrg={selectedOrg}
                            setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                        />

                        <HelpAndSupportSection />
                    </>
                )}
            </PageLayout>

            <SetupTracingModal
                open={isSetupTracingModal}
                onCancel={() => setIsSetupTracingModal(false)}
            />

            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />
        </>
    )
}

export default AppManagement
