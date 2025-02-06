import {useState, useEffect, useMemo} from "react"
import {Typography} from "antd"
import {Template, GenericObject, StyleProps} from "@/lib/Types"
import {isDemo, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {createAndStartTemplate, deleteApp, ServiceType} from "@/services/app-selector/api"
import {waitForAppToStart} from "@/services/api"

import {useAppsData} from "@/contexts/app.context"
import {useProfileData} from "@/contexts/profile.context"
import {usePostHogAg} from "@/lib/helpers/analytics/hooks/usePostHogAg"
import {type LlmProvider} from "@/lib/helpers/llmProviders"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import dayjs from "dayjs"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import GetStartedSection from "./components/GetStartedSection"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import ResultComponent from "@/components/ResultComponent/ResultComponent"
import {useProjectData} from "@/contexts/project.context"
import {useVaultSecret} from "@/hooks/useVaultSecret"
import useTemplates from "@/services/app-selector/hooks/useTemplates"
import {useStyles} from "./assets/styles"
import {getTemplateKey, timeout} from "./assets/helpers"
import {useOrgData} from "@/contexts/org.context"

const CreateAppStatusModal: any = dynamicComponent(
    "pages/app-management/modals/CreateAppStatusModal",
)
const AddAppFromTemplatedModal: any = dynamicComponent(
    "pages/app-management/modals/AddAppFromTemplateModal",
)
const MaxAppModal: any = dynamicComponent("pages/app-management/modals/MaxAppModal")
const WriteOwnAppModal: any = dynamicComponent("pages/app-management/modals/WriteOwnAppModal")
const SetupTracingModal: any = dynamicComponent("pages/app-management/modals/SetupTracingModal")

const ObservabilityDashboardSection: any = dynamicComponent(
    "pages/app-management/components/ObservabilityDashboardSection",
)
const DemoApplicationsSection: any = dynamicComponent(
    "pages/app-management/components/DemoApplicationsSection",
)

const {Title} = Typography

const AppManagement: React.FC = () => {
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const {user} = useProfileData()
    const [templateKey, setTemplateKey] = useState<ServiceType | undefined>(undefined)
    const [isAddAppFromTemplatedModal, setIsAddAppFromTemplatedModal] = useState(false)
    const [isWriteOwnAppModal, setIsWriteOwnAppModal] = useState(false)
    const [isSetupTracingModal, setIsSetupTracingModal] = useState(false)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [newApp, setNewApp] = useState("")
    const [searchTerm, setSearchTerm] = useState("")
    const {apps, error, isLoading, mutate} = useAppsData()

    const [statusData, setStatusData] = useState<{status: string; details?: any; appId?: string}>({
        status: "",
        details: undefined,
        appId: undefined,
    })
    const {secrets} = useVaultSecret()
    const {project} = useProjectData()
    const {selectedOrg} = useOrgData()

    const [{data: templates = [], isLoading: isLoadingTemplates}, noTemplateMessage] =
        useTemplates()

    const handleTemplateCardClick = async (template_id: string) => {
        setIsAddAppFromTemplatedModal(false)
        // warn the user and redirect if openAI key is not present
        // TODO: must be changed for multiples LLM keys
        if (redirectIfNoLLMKeys()) return

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        // attempt to create and start the template, notify user of the progress
        const apiKeys = secrets
        await createAndStartTemplate({
            appName: newApp,
            templateKey: template_id!,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            onStatusChange: async (status, details, appId) => {
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    setFetchingTemplate(false)
                if (status === "success") {
                    await mutate()
                    posthog?.capture?.("app_deployment", {
                        properties: {
                            app_id: appId,
                            environment: "UI",
                            deployed_by: user?.id,
                        },
                    })
                }

                setStatusData((prev) => ({status, details, appId: appId || prev.appId}))
            },
        })
    }

    const onErrorRetry = async () => {
        if (statusData.appId) {
            setStatusData((prev) => ({...prev, status: "cleanup", details: undefined}))
            await deleteApp(statusData.appId).catch(console.error)
            mutate()
        }
        handleTemplateCardClick(templateKey as ServiceType)
    }

    const onTimeoutRetry = async () => {
        if (!statusData.appId) return
        setStatusData((prev) => ({...prev, status: "starting_app", details: undefined}))
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
        mutate()
    }

    const appNameExist = useMemo(
        () =>
            apps.some((app: GenericObject) => app.app_name.toLowerCase() === newApp.toLowerCase()),
        [apps, newApp],
    )

    const filteredApps = useMemo(() => {
        let filtered = apps.sort(
            (a, b) => dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )

        if (searchTerm) {
            filtered = apps.filter((app) =>
                app.app_name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return filtered
    }, [apps, searchTerm])

    return (
        <>
            <div className={classes.container}>
                {isLoading || (!apps && !error) ? (
                    <ResultComponent status={"info"} title="Loading..." spinner={true} />
                ) : error ? (
                    <ResultComponent status={"error"} title="Failed to load" />
                ) : (
                    <>
                        <Title>App Management</Title>

                        <GetStartedSection
                            selectedOrg={selectedOrg}
                            apps={apps}
                            setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
                            setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                            setIsWriteOwnAppModal={setIsWriteOwnAppModal}
                            setIsSetupTracingModal={setIsSetupTracingModal}
                        />

                        <ObservabilityDashboardSection />

                        <ApplicationManagementSection
                            selectedOrg={selectedOrg}
                            apps={apps}
                            setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
                            setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                            filteredApps={filteredApps}
                            setSearchTerm={setSearchTerm}
                        />

                        {!project?.is_demo && <DemoApplicationsSection />}

                        <HelpAndSupportSection />
                    </>
                )}
            </div>

            <WriteOwnAppModal
                open={isWriteOwnAppModal}
                onCancel={() => setIsWriteOwnAppModal(false)}
            />

            <SetupTracingModal
                open={isSetupTracingModal}
                onCancel={() => setIsSetupTracingModal(false)}
            />

            <AddAppFromTemplatedModal
                open={isAddAppFromTemplatedModal}
                onCancel={() => setIsAddAppFromTemplatedModal(false)}
                newApp={newApp}
                templates={templates}
                noTemplateMessage={noTemplateMessage}
                templateKey={templateKey}
                appNameExist={appNameExist}
                setNewApp={setNewApp}
                onCardClick={(template: Template) => {
                    // TODO: temporary until there's a better way to handle this
                    const templateKey = getTemplateKey(template)

                    if (templateKey) {
                        setTemplateKey(templateKey)
                    }
                }}
                handleTemplateCardClick={handleTemplateCardClick}
                fetchingTemplate={fetchingTemplate}
            />

            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingTemplate}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => setStatusModalOpen(false)}
                statusData={statusData}
                appName={newApp}
            />
        </>
    )
}

export default AppManagement
