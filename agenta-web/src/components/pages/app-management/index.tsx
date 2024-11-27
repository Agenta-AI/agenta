import {useState, useEffect, useMemo} from "react"
import {Typography} from "antd"
import {Template, GenericObject, StyleProps, JSSTheme} from "@/lib/Types"
import {isDemo, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {createAndStartTemplate, fetchAllTemplates, deleteApp} from "@/services/app-selector/api"
import {waitForAppToStart} from "@/services/api"
import AddAppFromTemplatedModal from "./modals/AddAppFromTemplateModal"
import MaxAppModal from "./modals/MaxAppModal"
import WriteOwnAppModal from "./modals/WriteOwnAppModal"
import {createUseStyles} from "react-jss"
import {useAppsData} from "@/contexts/app.context"
import {useProfileData} from "@/contexts/profile.context"
import CreateAppStatusModal from "./modals/CreateAppStatusModal"
import {usePostHogAg} from "@/hooks/usePostHogAg"
import {LlmProvider, getAllProviderLlmKeys} from "@/lib/helpers/llmProviders"
import {dynamicContext} from "@/lib/helpers/dynamic"
import dayjs from "dayjs"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import HelpAndSupportSection from "./components/HelpAndSupportSection"
import DemoApplicationsSection from "./components/DemoApplicationsSection"
import GetStartedSection from "./components/GetStartedSection"
import ApplicationManagementSection from "./components/ApplicationManagementSection"
import SetupTracingModal from "./modals/SetupTracingModal"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: ({themeMode}: StyleProps) => ({
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading2,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading2,
        },
        "& h2.ant-typography": {
            fontSize: theme.fontSizeHeading3,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading3,
        },
        "& span.ant-typography": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            color: "inherit",
        },
    }),
}))

const timeout = isDemo() ? 60000 : 30000

const {Title} = Typography

const AppManagement: React.FC = () => {
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])
    const {user} = useProfileData()
    const [noTemplateMessage, setNoTemplateMessage] = useState("")
    const [templateId, setTemplateId] = useState<string | undefined>(undefined)
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

    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg} = useOrgData()

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    useEffect(() => {
        if (!isLoading) mutate()
        const fetchTemplates = async () => {
            const data = await fetchAllTemplates()
            if (typeof data == "object") {
                setTemplates(data)
            } else {
                setNoTemplateMessage(data)
            }
        }

        fetchTemplates()
    }, [])

    const handleTemplateCardClick = async (template_id: string) => {
        setIsAddAppFromTemplatedModal(false)
        // warn the user and redirect if openAI key is not present
        // TODO: must be changed for multiples LLM keys
        if (redirectIfNoLLMKeys()) return

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        // attempt to create and start the template, notify user of the progress
        const apiKeys = getAllProviderLlmKeys()
        await createAndStartTemplate({
            appName: newApp,
            templateId: template_id,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            timeout,
            onStatusChange: async (status, details, appId) => {
                setStatusData((prev) => ({status, details, appId: appId || prev.appId}))
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    setFetchingTemplate(false)
                if (status === "success") {
                    mutate()
                    posthog.capture("app_deployment", {
                        properties: {
                            app_id: appId,
                            environment: "UI",
                            deployed_by: user?.id,
                        },
                    })
                }
            },
        })
    }

    const onErrorRetry = async () => {
        if (statusData.appId) {
            setStatusData((prev) => ({...prev, status: "cleanup", details: undefined}))
            await deleteApp(statusData.appId).catch(console.error)
            mutate()
        }
        handleTemplateCardClick(templateId as string)
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
                <Title>App Management</Title>

                <GetStartedSection
                    selectedOrg={selectedOrg}
                    apps={apps}
                    setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
                    setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                    setIsWriteOwnAppModal={setIsWriteOwnAppModal}
                    setIsSetupTracingModal={setIsSetupTracingModal}
                />

                <ApplicationManagementSection
                    selectedOrg={selectedOrg}
                    apps={apps}
                    setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal}
                    setIsMaxAppModalOpen={setIsMaxAppModalOpen}
                    filteredApps={filteredApps}
                    setSearchTerm={setSearchTerm}
                    isLoading={isLoading}
                    error={error}
                />

                <DemoApplicationsSection />

                <HelpAndSupportSection />
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
                templateId={templateId}
                appNameExist={appNameExist}
                setNewApp={setNewApp}
                onCardClick={(template) => {
                    setTemplateId(template.id)
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
