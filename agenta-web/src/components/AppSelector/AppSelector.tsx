import {useState, useEffect} from "react"
import {useRouter} from "next/router"
import {PlusOutlined} from "@ant-design/icons"
import {Input, Modal, ConfigProvider, theme, Spin, Card, Button, notification, Divider} from "antd"
import AppCard from "./AppCard"
import {Template, GenericObject} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {CloseCircleFilled} from "@ant-design/icons"
import TipsAndFeatures from "./TipsAndFeatures"
import Welcome from "./Welcome"
import {getOpenAIKey, isAppNameInputValid, isDemo} from "@/lib/helpers/utils"
import {createAndStartTemplate, getTemplates} from "@/lib/services/api"
import AddNewAppModal from "./modals/AddNewAppModal"
import AddAppFromTemplatedModal from "./modals/AddAppFromTemplateModal"
import MaxAppModal from "./modals/MaxAppModal"
import WriteOwnAppModal from "./modals/WriteOwnAppModal"
import {createUseStyles} from "react-jss"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {useAppsData} from "@/contexts/app.context"
import {useProfileData} from "@/contexts/profile.context"

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
        gap: 12,
        "& .ant-card-bordered, .ant-card-actions": {
            borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.1)",
        },
    }),
    createCard: {
        fontSize: 20,
        backgroundColor: "#1777FF",
        borderColor: "#1777FF !important",
        color: "#FFFFFF",
        width: 300,
        height: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        "& .ant-card-meta-title": {
            color: "#FFFFFF",
        },
    },
    createCardMeta: {
        height: "90%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-evenly",
    },
    closeIcon: {
        fontSize: 20,
        color: "red",
    },
    divider: ({themeMode}: StyleProps) => ({
        marginTop: 0,
        borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.15)",
    }),
    h1: {
        fontSize: 24,
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

const AppSelector: React.FC = () => {
    const router = useRouter()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isCreateAppFromTemplateModalOpen, setIsCreateAppFromTemplateModalOpen] = useState(false)
    const [isWriteAppModalOpen, setIsWriteAppModalOpen] = useState(false)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])

    const [templateMessage, setTemplateMessage] = useState("")
    const [templateName, setTemplateName] = useState<string | undefined>(undefined)
    const [isInputTemplateModalOpen, setIsInputTemplateModalOpen] = useState<boolean>(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [appNameExist, setAppNameExist] = useState(false)
    const [newApp, setNewApp] = useState("")
    const {selectedOrg} = useProfileData()
    const {apps, error, isLoading, mutate} = useAppsData()

    const showCreateAppModal = async () => {
        setIsCreateAppModalOpen(true)
    }

    const showMaxAppError = () => {
        setIsMaxAppModalOpen(true)
    }
    const showCreateAppFromTemplateModal = () => {
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
        setNewApp("")
        setTemplateName(undefined)
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

    const handleTemplateCardClick = async (image_name: string) => {
        setFetchingTemplate(true)

        // cleanup routine
        const onFinish = () => {
            setFetchingTemplate(false)
            handleCreateAppFromTemplateModalCancel()
            handleCreateAppModalCancel()
            handleInputTemplateModalCancel()
        }

        // warn the user and redirect if openAI key is not present
        const openAIKey = getOpenAIKey()
        if (!openAIKey && !isDemo()) {
            notification.error({
                message: "OpenAI API Key Missing",
                description: "Please provide your OpenAI API key to access this feature.",
                duration: 5,
            })
            onFinish()
            router.push("/settings?tab=secrets")
            return
        }

        let prevKey = ""
        const showNotification = (config: Parameters<typeof notification.open>[0]) => {
            if (prevKey) notification.destroy(prevKey)
            prevKey = (config.key || "") as string
            notification.open(config)
        }

        // attempt to create and start the template, notify user of the progress
        await createAndStartTemplate({
            appName: newApp,
            imageName: image_name,
            orgId: selectedOrg?.id!,
            openAIKey: isDemo() ? "" : (openAIKey as string),
            onStatusChange: (status, details, appId) => {
                const title = "Template Selection"
                switch (status) {
                    case "fetching_image":
                        showNotification({
                            type: "info",
                            message: title,
                            description: "Fetching template image...",
                            key: status,
                        })
                        break
                    case "creating_app":
                        showNotification({
                            type: "info",
                            message: title,
                            description: "Creating variant from template image...",
                            key: status,
                        })
                        break
                    case "starting_app":
                        showNotification({
                            type: "info",
                            message: title,
                            description: "Waiting for the app to start...",
                            key: status,
                        })
                        break
                    case "success":
                        showNotification({
                            type: "success",
                            message: title,
                            description:
                                "App has been started! Redirecting to the variant playground.",
                            key: status,
                        })
                        onFinish()
                        router.push(`/apps/${appId}/playground`)
                        break
                    case "bad_request":
                        showNotification({
                            type: "error",
                            message: title,
                            description: getErrorMessage(details),
                            duration: 5,
                            btn: (
                                <Button>
                                    <a
                                        target="_blank"
                                        href="https://github.com/Agenta-AI/agenta/issues/new?assignees=&labels=demo&projects=&template=bug_report.md&title="
                                    >
                                        File Issue
                                    </a>
                                </Button>
                            ),
                            key: status,
                        })
                        onFinish()
                        break
                    case "timeout":
                        showNotification({
                            type: "error",
                            message: title,
                            description:
                                "The app took too long to start. Please refresh this page after some delay to see the new app",
                            key: status,
                        })
                        onFinish()
                        break
                    case "error":
                        showNotification({
                            type: "error",
                            message: title,
                            description: getErrorMessage(details),
                            key: status,
                        })
                        onFinish()
                        break
                }
            },
        })
    }

    useEffect(() => {
        setTimeout(() => {
            if (apps) {
                setAppNameExist(apps.some((app: GenericObject) => app.app_name === newApp))
            }
        }, 3000)
    }, [apps, newApp])

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div className={classes.container}>
                {isLoading ? (
                    <div>
                        <Spin />
                        <h1>loading...</h1>
                    </div>
                ) : error ? (
                    <div>
                        <CloseCircleFilled className={classes.closeIcon} />
                        <h1>failed to load</h1>
                    </div>
                ) : Array.isArray(apps) && apps.length ? (
                    <>
                        <h1 className={classes.h1}>LLM Applications</h1>
                        <Divider className={classes.divider} />
                        <div className={classes.cardsList}>
                            {Array.isArray(apps) && (
                                <>
                                    {apps.map((app, index: number) => (
                                        <div key={index}>
                                            <AppCard app={app} />
                                        </div>
                                    ))}
                                    <Card
                                        className={classes.createCard}
                                        onClick={() => {
                                            if (isDemo() && apps.length > 1) {
                                                showMaxAppError()
                                            } else {
                                                showCreateAppModal()
                                            }
                                        }}
                                    >
                                        <Card.Meta
                                            data-cy="create-new-app-button"
                                            className={classes.createCardMeta}
                                            title={<div>Create New App</div>}
                                            avatar={<PlusOutlined size={24} />}
                                        />
                                    </Card>
                                </>
                            )}
                        </div>

                        <TipsAndFeatures />
                    </>
                ) : (
                    <Welcome onCreateAppClick={showCreateAppModal} />
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
                    setTemplateName(template.image.name)
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
                    disabled={fetchingTemplate}
                />
                {appNameExist && <div className={classes.modalError}>App name already exist</div>}
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
                    onClick={() => {
                        if (appNameExist) {
                            notification.warning({
                                message: "Template Selection",
                                description:
                                    "App name already exists. Please choose a different name.",
                                duration: 3,
                            })
                        } else if (
                            fetchingTemplate &&
                            newApp.length > 0 &&
                            isAppNameInputValid(newApp)
                        ) {
                            notification.info({
                                message: "Template Selection",
                                description:
                                    "The template image is currently being fetched. Please wait...",
                                duration: 3,
                            })
                        } else if (
                            !fetchingTemplate &&
                            newApp.length > 0 &&
                            isAppNameInputValid(newApp)
                        ) {
                            handleTemplateCardClick(templateName as string)
                        } else {
                            notification.warning({
                                message: "Template Selection",
                                description:
                                    "Please provide a valid app name to choose a template.",
                                duration: 3,
                            })
                        }
                    }}
                >
                    Create
                </Button>
            </Modal>

            <WriteOwnAppModal open={isWriteAppModalOpen} onCancel={handleWriteApppModalCancel} />
        </ConfigProvider>
    )
}

export default AppSelector
