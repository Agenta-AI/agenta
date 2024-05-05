import {useState, useEffect, useMemo} from "react"
import {PlusOutlined} from "@ant-design/icons"
import {Input, Modal, ConfigProvider, theme, Card, Button, notification, Divider} from "antd"
import AppCard from "./AppCard"
import {Template, GenericObject} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import TipsAndFeatures from "./TipsAndFeatures"
import Welcome from "./Welcome"
import {isAppNameInputValid, isDemo, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {
    createAndStartTemplate,
    getTemplates,
    removeApp,
    waitForAppToStart,
} from "@/lib/services/api"
import AddNewAppModal from "./modals/AddNewAppModal"
import AddAppFromTemplatedModal from "./modals/AddAppFromTemplateModal"
import MaxAppModal from "./modals/MaxAppModal"
import WriteOwnAppModal from "./modals/WriteOwnAppModal"
import {createUseStyles} from "react-jss"
import {useAppsData} from "@/contexts/app.context"
import {useProfileData} from "@/contexts/profile.context"
import CreateAppStatusModal from "./modals/CreateAppStatusModal"
import {usePostHogAg} from "@/hooks/usePostHogAg"
import {LlmProvider, getAllProviderLlmKeys, getApikeys} from "@/lib/helpers/llmProviders"
import ResultComponent from "../ResultComponent/ResultComponent"
import {dynamicContext} from "@/lib/helpers/dynamic"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    container: ({themeMode}: StyleProps) => ({
        marginTop: 10,
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    cardsList: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        "& .ant-card-bordered, .ant-card-actions": {
            borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.1)",
        },
    }),
    createCard: ({themeMode}: StyleProps) => ({
        fontSize: 20,
        backgroundColor: themeMode === "dark" ? "" : "hsl(0, 0%, 100%)",
        borderColor: themeMode === "dark" ? "hsl(0, 0%, 100%)" : "hsl(0, 0%, 10%) !important",
        color: themeMode === "dark" ? "#fff" : "#000",
        boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)",

        width: 300,
        height: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        "& .ant-card-meta-title": {
            color: themeMode === "dark" ? "#fff" : "#000",
        },
    }),
    createCardMeta: ({themeMode}: StyleProps) => ({
        height: "90%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-evenly",
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    closeIcon: {
        fontSize: 20,
        color: "red",
    },
    divider: ({themeMode}: StyleProps) => ({
        marginTop: 0,
        marginBottom: 32,
        borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.15)",
    }),
    h1: {
        fontSize: 28,
        fontWeight: "normal",
    },
    modal: {
        "& .ant-modal-body": {
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            marginTop: 20,
        },
    },
    modalError: {
        color: "red",
        marginLeft: "10px",
    },
    modalBtn: {
        alignSelf: "flex-end",
    },
})

const timeout = isDemo() ? 60000 : 30000

const AppSelector: React.FC = () => {
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isCreateAppFromTemplateModalOpen, setIsCreateAppFromTemplateModalOpen] = useState(false)
    const [isWriteAppModalOpen, setIsWriteAppModalOpen] = useState(false)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])
    const {user} = useProfileData()
    const [templateMessage, setTemplateMessage] = useState("")
    const [templateId, setTemplateId] = useState<string | undefined>(undefined)
    const [isInputTemplateModalOpen, setIsInputTemplateModalOpen] = useState<boolean>(false)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [newApp, setNewApp] = useState("")
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

    const showCreateAppModal = async () => {
        setIsCreateAppModalOpen(true)
    }

    const showMaxAppError = () => {
        setIsMaxAppModalOpen(true)
    }
    const showCreateAppFromTemplateModal = () => {
        setTemplateId(undefined)
        setNewApp("")
        setIsCreateAppModalOpen(false)
        setIsCreateAppFromTemplateModalOpen(true)
    }

    const showWriteAppModal = () => {
        setIsCreateAppModalOpen(false)
        setIsWriteAppModalOpen(true)
    }

    const showInputTemplateModal = () => {
        setIsCreateAppFromTemplateModalOpen(false)
        setIsInputTemplateModalOpen(true)
    }

    const handleCreateAppFromTemplateModalCancel = () => {
        setIsCreateAppFromTemplateModalOpen(false)
    }

    const handleWriteApppModalCancel = () => {
        setIsWriteAppModalOpen(false)
    }

    const handleCreateAppModalCancel = () => {
        setIsCreateAppModalOpen(false)
    }

    const handleInputTemplateModalCancel = () => {
        if (fetchingTemplate) return
        setIsInputTemplateModalOpen(false)
    }

    useEffect(() => {
        if (!isLoading) mutate()
        const fetchTemplates = async () => {
            const data = await getTemplates()
            if (typeof data == "object") {
                setTemplates(data)
            } else {
                setTemplateMessage(data)
            }
        }

        fetchTemplates()
    }, [])

    const handleTemplateCardClick = async (template_id: string) => {
        handleInputTemplateModalCancel()
        handleCreateAppFromTemplateModalCancel()
        handleCreateAppModalCancel()

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
            await removeApp(statusData.appId).catch(console.error)
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

    const handleEnterKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            handleCreateApp()
        }
    }

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

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div className={classes.container}>
                {isLoading ? (
                    <div>
                        <ResultComponent status={"info"} title="Loading..." spinner={true} />
                    </div>
                ) : error ? (
                    <div>
                        <ResultComponent status={"error"} title="Failed to load" />
                    </div>
                ) : Array.isArray(apps) && apps.length ? (
                    <>
                        <h1 className={classes.h1}>Applications</h1>
                        <Divider className={classes.divider} />
                        <div className={classes.cardsList}>
                            {Array.isArray(apps) && (
                                <>
                                    <Card
                                        className={classes.createCard}
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
                                        <Card.Meta
                                            data-cy="create-new-app-button"
                                            className={classes.createCardMeta}
                                            title={<div>Create new app</div>}
                                            avatar={<PlusOutlined size={24} />}
                                        />
                                    </Card>

                                    {apps.map((app, index: number) => (
                                        <div key={index}>
                                            <AppCard app={app} />
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <TipsAndFeatures />
                    </>
                ) : (
                    <Welcome
                        onWriteOwnApp={showWriteAppModal}
                        onCreateFromTemplate={showCreateAppFromTemplateModal}
                    />
                )}
            </div>

            <AddNewAppModal
                open={isCreateAppModalOpen}
                onCancel={handleCreateAppModalCancel}
                onCreateFromTemplate={showCreateAppFromTemplateModal}
                onWriteOwnApp={showWriteAppModal}
            />
            <AddAppFromTemplatedModal
                open={isCreateAppFromTemplateModalOpen}
                onCancel={handleCreateAppFromTemplateModalCancel}
                newApp={newApp}
                templates={templates}
                noTemplateMessage={templateMessage}
                onCardClick={(template) => {
                    showInputTemplateModal()
                    setTemplateId(template.id)
                }}
            />
            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />
            <Modal
                data-cy="enter-app-name-modal"
                title="Enter the app name"
                open={isInputTemplateModalOpen}
                onCancel={handleInputTemplateModalCancel}
                width={500}
                footer={null}
                centered
                className={classes.modal}
            >
                <Input
                    placeholder="New app name (e.g., chat-app)"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                    onKeyDown={handleEnterKeyPress}
                    disabled={fetchingTemplate}
                />
                {appNameExist && <div className={classes.modalError}>App name already exists</div>}
                {newApp.length > 0 && !isAppNameInputValid(newApp) && (
                    <div className={classes.modalError} data-cy="enter-app-name-modal-text-warning">
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}
                <Button
                    data-cy="enter-app-name-modal-button"
                    className={classes.modalBtn}
                    type="primary"
                    loading={fetchingTemplate}
                    disabled={appNameExist || newApp.length === 0}
                    onClick={handleCreateApp}
                >
                    Create
                </Button>
            </Modal>
            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingTemplate}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => setStatusModalOpen(false)}
                statusData={statusData}
                appName={newApp}
            />

            <WriteOwnAppModal open={isWriteAppModalOpen} onCancel={handleWriteApppModalCancel} />
        </ConfigProvider>
    )
}

export default AppSelector
