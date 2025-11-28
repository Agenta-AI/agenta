import {useMemo, useState} from "react"

import {Typography} from "antd"
import dayjs from "dayjs"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {type LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {Template, GenericObject, StyleProps} from "@/oss/lib/Types"
import {waitForAppToStart} from "@/oss/services/api"
import {createAndStartTemplate, deleteApp, ServiceType} from "@/oss/services/app-selector/api"
import useTemplates from "@/oss/services/app-selector/hooks/useTemplates"
import {useAppsData} from "@/oss/state/app"
import {appCreationStatusAtom, resetAppCreationAtom} from "@/oss/state/appCreation/status"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"

import {getTemplateKey, timeout} from "./assets/helpers"
import {useStyles} from "./assets/styles"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import GetStartedSection from "./components/GetStartedSection"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import useCustomWorkflowConfig from "./modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import ProjectHeaderActions from "./components/ProjectHeaderActions"
import {useProjectData} from "@/oss/state/project"

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
const {Title} = Typography

const AppManagement: React.FC = () => {
    const {project} = useProjectData()
    const statusData = useAtomValue(appCreationStatusAtom)
    const setStatusData = useSetAtom(appCreationStatusAtom)
    const resetAppCreation = useSetAtom(resetAppCreationAtom)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [fetchingCustomWorkflow, setFetchingCustomWorkflow] = useState(false)
    const {openModal} = useCustomWorkflowConfig({
        setStatusModalOpen,
        setFetchingTemplate: setFetchingCustomWorkflow,
        appId: "",
    })
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const {user} = useProfileData()
    const [templateKey, setTemplateKey] = useState<ServiceType | undefined>(undefined)
    const [isAddAppFromTemplatedModal, setIsAddAppFromTemplatedModal] = useState(false)
    const [isSetupTracingModal, setIsSetupTracingModal] = useState(false)
    const [newApp, setNewApp] = useState("")
    const [searchTerm, setSearchTerm] = useState("")
    const {apps, error, mutate} = useAppsData()

    const {secrets} = useVaultSecret()
    const {selectedOrg} = useOrgData()

    const [{data: templates = [], isLoading: fetchingTemplate}, noTemplateMessage] = useTemplates()

    const handleTemplateCardClick = async (template_id: string) => {
        setIsAddAppFromTemplatedModal(false)
        setStatusModalOpen(true)
        resetAppCreation()

        // attempt to create and start the template, notify user of the progress
        const apiKeys = secrets
        await createAndStartTemplate({
            appName: newApp,
            templateKey: template_id! as ServiceType,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            onStatusChange: async (status, details, appId) => {
                if (["error", "bad_request", "timeout", "success"].includes(status))
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

                setStatusData((prev) => ({...prev, status, details, appId: appId || prev.appId}))
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
                {error ? (
                    <ResultComponent status={"error"} title="Failed to load" />
                ) : (
                    <>
                        <div className="flex items-center gap-3 flex-wrap">
                            <Title level={3} className="!m-0 flex items-center gap-2 min-w-0">
                                <span
                                    className="truncate max-w-[360px]"
                                    title={project?.project_name || "Project"}
                                >
                                    {project?.project_name || "Project"}
                                </span>
                                <span className="text-neutral-500 whitespace-nowrap">
                                    App Management
                                </span>
                            </Title>

                            <ProjectHeaderActions />
                        </div>

                        <GetStartedSection
                            selectedOrg={selectedOrg}
                            apps={apps}
                            setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
                            setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                            setIsWriteOwnAppModal={openModal}
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

                        <HelpAndSupportSection />
                    </>
                )}
            </div>

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
                afterClose={() => {
                    setTemplateKey(undefined)
                    setNewApp("")
                }}
            />

            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingTemplate || fetchingCustomWorkflow}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => {
                    setStatusModalOpen(false)
                    resetAppCreation()
                }}
                statusData={statusData}
                appName={newApp}
            />
        </>
    )
}

export default AppManagement
