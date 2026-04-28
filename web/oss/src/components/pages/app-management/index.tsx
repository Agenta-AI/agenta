import {useEffect, useState} from "react"

import {archiveWorkflow, invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {welcomeCardsDismissedAtom} from "@/oss/components/pages/app-management/components/WelcomeCardsSection/assets/store/welcomeCards"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {type LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {
    onboardingWidgetActivationAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {StyleProps} from "@/oss/lib/Types"
import {waitForAppToStart} from "@/oss/services/api"
import {createAppWithTemplate} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"
import {appCreationStatusAtom, resetAppCreationAtom} from "@/oss/state/appCreation/status"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {getProjectValues} from "@/oss/state/project"

import {timeout} from "./assets/helpers"
import {useStyles} from "./assets/styles"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import WelcomeCardsSection from "./components/WelcomeCardsSection"
import {invalidateAppManagementWorkflowQueries} from "./store"

const CreateAppStatusModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/CreateAppStatusModal"),
)
const AddAppFromTemplatedModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/AddAppFromTemplateModal"),
)
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
    const statusData = useAtomValue(appCreationStatusAtom)
    const setStatusData = useSetAtom(appCreationStatusAtom)
    const resetAppCreation = useSetAtom(resetAppCreationAtom)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const welcomeCardsDismissed = useAtomValue(welcomeCardsDismissedAtom)
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const {user} = useProfileData()
    const [templateKey, setTemplateKey] = useState<string | undefined>(undefined)
    const [isAddAppFromTemplatedModal, setIsAddAppFromTemplatedModal] = useState(false)
    const [isSetupTracingModal, setIsSetupTracingModal] = useState(false)
    const [appName, setAppName] = useState("")
    const [appSlug, setAppSlug] = useState<string | undefined>(undefined)
    const {error, mutate} = useAppsData()

    const {secrets} = useVaultSecret()
    const {selectedOrg} = useOrgData()

    const handleTemplateCardClick = async (
        templateId: string,
        submittedAppName: string,
        submittedAppSlug?: string,
    ) => {
        setAppName(submittedAppName)
        setAppSlug(submittedAppSlug)
        setTemplateKey(templateId)
        setIsAddAppFromTemplatedModal(false)
        setStatusModalOpen(true)
        resetAppCreation()

        // attempt to create and start the template, notify user of the progress
        const apiKeys = secrets
        await createAppWithTemplate({
            appName: submittedAppName,
            slug: submittedAppSlug,
            templateKey: templateId,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            onStatusChange: async (status, details, appId) => {
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    if (status === "success") {
                        await mutate()
                        await invalidateAppManagementWorkflowQueries()
                        posthog?.capture?.("app_deployment", {
                            properties: {
                                app_id: appId,
                                environment: "UI",
                                deployed_by: user?.id,
                            },
                        })
                        recordWidgetEvent("prompt_created")
                    }

                setStatusData((prev) => ({...prev, status, details, appId: appId || prev.appId}))
            },
        })
    }

    useEffect(() => {
        if (onboardingWidgetActivation !== "open-create-prompt") return
        setIsAddAppFromTemplatedModal(true)
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setOnboardingWidgetActivation])

    useEffect(() => {
        if (onboardingWidgetActivation !== "tracing-snippet") return
        setIsSetupTracingModal(true)
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setOnboardingWidgetActivation])

    const onErrorRetry = async () => {
        if (statusData.appId) {
            setStatusData((prev) => ({...prev, status: "cleanup", details: undefined}))
            const {projectId} = getProjectValues()
            await archiveWorkflow(projectId, statusData.appId).catch(console.error)
            invalidateWorkflowsListCache()
            await mutate()
            await invalidateAppManagementWorkflowQueries()
        }
        handleTemplateCardClick(templateKey as string, appName, appSlug)
    }

    const onTimeoutRetry = async () => {
        if (!statusData.appId) return
        setStatusData((prev) => ({...prev, status: "configuring_app", details: undefined}))
        try {
            await waitForAppToStart({appId: statusData.appId, timeout})
        } catch (error: any) {
            if (error.message === "timeout") {
                setStatusData((prev) => ({...prev, status: "timeout", details: undefined}))
            } else {
                setStatusData((prev) => ({...prev, status: "error", details: error}))
            }
        }
        setStatusData((prev) => ({...prev, status: "success", details: undefined}))
        await mutate()
        await invalidateAppManagementWorkflowQueries()
    }

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
                            onCreatePrompt={() => setIsAddAppFromTemplatedModal(true)}
                            onSetupTracing={() => setIsSetupTracingModal(true)}
                        />

                        <ObservabilityDashboardSection />

                        <ApplicationManagementSection
                            selectedOrg={selectedOrg}
                            setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
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

            <AddAppFromTemplatedModal
                open={isAddAppFromTemplatedModal}
                onCancel={() => setIsAddAppFromTemplatedModal(false)}
                handleTemplateCardClick={handleTemplateCardClick}
            />

            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={false}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => {
                    setStatusModalOpen(false)
                    resetAppCreation()
                }}
                statusData={statusData}
                appName={appName}
            />
        </>
    )
}

export default AppManagement
