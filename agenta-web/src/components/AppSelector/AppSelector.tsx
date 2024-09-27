import {useState, useEffect, useMemo} from "react"
import {PlusOutlined} from "@ant-design/icons"
import {Modal, ConfigProvider, theme, Button, notification, Typography} from "antd"
import AppCard from "./AppCard"
import {Template, GenericObject, StyleProps, JSSTheme} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import TipsAndFeatures from "./TipsAndFeatures"
import Welcome from "./Welcome"
import {isAppNameInputValid, isDemo, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
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
import ResultComponent from "../ResultComponent/ResultComponent"
import {dynamicContext} from "@/lib/helpers/dynamic"
import AppTemplateCard from "./AppTemplateCard"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: ({themeMode}: StyleProps) => ({
        marginTop: "24px",
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    cardsList: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        "& .ant-card-bordered, .ant-card-actions": {
            borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.1)",
        },
    }),
    title: {
        fontSize: 16,
        fontWeight: theme.fontWeightMedium,
        lineHeight: "24px",
    },
    modal: {
        transitionDuration: "0.3s",
        "& .ant-modal-content": {
            overflow: "hidden",
            padding: 0,
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
    mainContainer: {
        padding: "20px 24px",
        gap: 16,
        display: "flex",
        flexDirection: "column",
    },
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
}))

const timeout = isDemo() ? 60000 : 30000

const AppSelector: React.FC = () => {
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])
    const {user} = useProfileData()
    const [templateMessage, setTemplateMessage] = useState("")
    const [templateId, setTemplateId] = useState<string | undefined>(undefined)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [newApp, setNewApp] = useState("")
    const [current, setCurrent] = useState(0)
    const {apps, error, isLoading, mutate} = useAppsData()
    const [statusData, setStatusData] = useState<{status: string; details?: any; appId?: string}>({
        status: "",
        details: undefined,
        appId: undefined,
    })
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg} = useOrgData()

    const appLuanch = Array.isArray(apps) && apps.length > 0

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const showCreateAppModal = async () => {
        setIsCreateAppModalOpen(true)
        setCurrent(0)
    }

    const showMaxAppError = () => {
        setIsMaxAppModalOpen(true)
    }

    const showCreateAppFromTemplateModal = () => {
        setTemplateId(undefined)
        setNewApp("")
        setIsCreateAppModalOpen(true)
        setCurrent(appLuanch ? 1 : 0)
    }

    const showWriteAppModal = () => {
        setIsCreateAppModalOpen(true)
        setCurrent(appLuanch ? 2 : 0)
    }

    useEffect(() => {
        if (!isLoading) mutate()
        const fetchTemplates = async () => {
            const data = await fetchAllTemplates()
            if (typeof data == "object") {
                setTemplates(data)
            } else {
                setTemplateMessage(data)
            }
        }

        fetchTemplates()
    }, [])

    const handleTemplateCardClick = async (template_id: string) => {
        setIsCreateAppModalOpen(false)
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

    const handleCreateApp = () => {
        if (appNameExist) {
            notification.warning({
                message: "Template Selection",
                description: "App name already exists. Please choose a different name.",
                duration: 3,
            })
        } else if (fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            notification.info({
                message: "Template Selection",
                description: "The template image is currently being fetched. Please wait...",
                duration: 3,
            })
        } else if (!fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            handleTemplateCardClick(templateId as string)
        } else {
            notification.warning({
                message: "Template Selection",
                description: "Please provide a valid app name to choose a template.",
                duration: 3,
            })
        }
    }

    const steps = [
        {
            content: (
                <AddAppFromTemplatedModal
                    setCurrent={setCurrent}
                    appLuanch={appLuanch}
                    newApp={newApp}
                    setNewApp={setNewApp}
                    templates={templates}
                    noTemplateMessage={templateMessage}
                    templateId={templateId}
                    onCardClick={(template) => {
                        setTemplateId(template.id)
                    }}
                    appNameExist={appNameExist}
                    handleCreateApp={handleCreateApp}
                />
            ),
        },
        {
            content: <WriteOwnAppModal setCurrent={setCurrent} appLuanch={appLuanch} />,
        },
    ]

    if (appLuanch) {
        steps.unshift({
            content: (
                <section className={classes.mainContainer}>
                    <Typography.Text className={classes.headerText}>Add new app</Typography.Text>

                    <AppTemplateCard
                        onWriteOwnApp={showWriteAppModal}
                        onCreateFromTemplate={showCreateAppFromTemplateModal}
                    />
                </section>
            ),
        })
    }

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div className={classes.container}>
                {!isLoading && !error ? (
                    <div className="flex items-center justify-between mb-5">
                        <h1 className={classes.title}>App Management</h1>
                        {Array.isArray(apps) && apps.length ? (
                            <Button
                                type="primary"
                                data-cy="create-new-app-button"
                                icon={<PlusOutlined />}
                                onClick={() => {
                                    if (
                                        isDemo() &&
                                        selectedOrg?.is_paying == false &&
                                        apps.length > 2
                                    ) {
                                        showMaxAppError()
                                    } else {
                                        showCreateAppModal()
                                    }
                                }}
                            >
                                Create new app
                            </Button>
                        ) : null}
                    </div>
                ) : null}

                {isLoading ? (
                    <div>
                        <ResultComponent status={"info"} title="Loading..." spinner={true} />
                    </div>
                ) : error ? (
                    <div>
                        <ResultComponent status={"error"} title="Failed to load" />
                    </div>
                ) : Array.isArray(apps) && apps.length ? (
                    <div className="flex flex-col gap-6">
                        <div className={classes.cardsList}>
                            {Array.isArray(apps) && (
                                <>
                                    {apps.map((app, index: number) => (
                                        <div key={index}>
                                            <AppCard app={app} />
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <TipsAndFeatures />
                    </div>
                ) : (
                    <Welcome
                        onWriteOwnApp={showWriteAppModal}
                        onCreateFromTemplate={showCreateAppFromTemplateModal}
                    />
                )}
            </div>

            <Modal
                open={isCreateAppModalOpen}
                afterClose={() => setCurrent(0)}
                onCancel={() => {
                    setIsCreateAppModalOpen(false)
                }}
                footer={null}
                title={null}
                className={classes.modal}
                width={steps.length === 3 && current == 0 ? 845 : 480}
                centered
            >
                {steps[current]?.content}
            </Modal>

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
        </ConfigProvider>
    )
}

export default AppSelector
