import {useState, useEffect} from "react"
import {useRouter} from "next/router"
import {PlusOutlined} from "@ant-design/icons"
import {
    Input,
    Modal,
    ConfigProvider,
    theme,
    Spin,
    Card,
    Button,
    notification,
    Divider,
    Typography,
} from "antd"
import AppCard from "./AppCard"
import {Template, AppTemplate, TemplateImage, GenericObject} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {CloseCircleFilled} from "@ant-design/icons"
import TipsAndFeatures from "./TipsAndFeatures"
import Welcome from "./Welcome"
import {isAppNameInputValid} from "@/lib/helpers/utils"
import {fetchApps, getTemplates, pullTemplateImage, startTemplate} from "@/lib/services/api"
import AddNewAppModal from "./modals/AddNewAppModal"
import AddAppFromTemplatedModal from "./modals/AddAppFromTemplateModal"
import WriteOwnAppModal from "./modals/WriteOwnAppModal"
import {createUseStyles} from "react-jss"

type StyleProps = {
    themeMode: "dark" | "light"
}

const {Title} = Typography

const useStyles = createUseStyles({
    container: ({themeMode}: StyleProps) => ({
        maxWidth: "1450px",
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
    const [templates, setTemplates] = useState<Template[]>([])

    const [templateMessage, setTemplateMessage] = useState("")
    const [templateName, setTemplateName] = useState<string | undefined>(undefined)
    const [isInputTemplateModalOpen, setIsInputTemplateModalOpen] = useState<boolean>(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [appNameExist, setAppNameExist] = useState(false)
    const [newApp, setNewApp] = useState("")

    const isDemo = process.env.NEXT_PUBLIC_FF === "demo"

    const showCreateAppModal = () => {
        setIsCreateAppModalOpen(true)
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

    const handleNavigation = () => {
        notification.success({
            message: "Template Selection",
            description:
                "Once your app is up and running, you'll be redirected to the app playground.",
            duration: 9,
        })
        setTimeout(() => {
            router.push(`/apps/${newApp}/playground`)
        }, 10000)
    }

    useEffect(() => {
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

    const fetchTemplateImage = async (image_name: string) => {
        const response = await pullTemplateImage(image_name)
        return response
    }

    const retrieveOpenAIKey = () => {
        const apiKey = localStorage.getItem("openAiToken")
        return apiKey
    }

    const createAppVariantFromTemplateImage = async (
        app_name: string,
        image_id: string,
        image_tag: string,
        api_key: string,
    ) => {
        const variantData: AppTemplate = {
            app_name: app_name,
            image_id: image_id,
            image_tag: image_tag,
        }
        if (!isDemo) {
            variantData["env_vars"] = {
                OPENAI_API_KEY: api_key,
            }
        } else {
            variantData["env_vars"] = {
                OPENAI_API_KEY: "",
            }
        }
        
        try {
            const response = await startTemplate(variantData)
            if (response.status == 200) {
                notification.success({
                    message: "Template Selection",
                    description: "App has been created and will begin to run.",
                    duration: 5,
                })
                return true
            }
        } catch(error: any) {
            if (error.response.status === 404) {
                notification.error({
                    message: "Template Selection",
                    description: `${error.response.data.detail}`,
                    duration: 5,
                    btn: (
                        <Button>
                            <a 
                                target="_blank" 
                                href="https://github.com/Agenta-AI/agenta/issues/new?assignees=&labels=demo&projects=&template=bug_report.md&title=">
                                    File Issue
                            </a>
                        </Button>
                    )
                })
                setFetchingTemplate(false)
                return false
            } else {
                notification.error({
                    message: "Template Selection",
                    description: "An error occured when trying to start the variant.",
                    duration: 5,
                })
                setFetchingTemplate(false)
                return false
            }
        }
    }

    const handleTemplateCardClick = async (image_name: string) => {
        setFetchingTemplate(true)

        const OpenAIKey = retrieveOpenAIKey() as string
        if (OpenAIKey === null) {
            notification.error({
                message: "OpenAI API Key Missing",
                description: "Please provide your OpenAI API key to access this feature.",
                duration: 5,
            })
            router.push("/apikeys")
            return
        }

        notification.info({
            message: "Template Selection",
            description: "Fetching template image...",
            duration: 10,
        })

        const data: TemplateImage = await fetchTemplateImage(image_name)
        if (data.message) {
            notification.error({
                message: "Template Selection",
                description: `${data.message}!`,
                duration: 10,
            })
            setFetchingTemplate(false)
        } else {
            notification.info({
                message: "Template Section",
                description: "Creating variant from template image...",
                duration: 15,
            })
            const status = await createAppVariantFromTemplateImage(
                newApp,
                data.image_id,
                data.image_tag,
                OpenAIKey,
            )
            if (status) {
                handleCreateAppFromTemplateModalCancel()
                handleCreateAppModalCancel()
                handleNavigation()
            } else if(!status) {
                handleInputTemplateModalCancel()
            }
        }
    }

    const {data, error, isLoading} = fetchApps()
    useEffect(() => {
        setTimeout(() => {
            if (data) {
                setAppNameExist(data.some((app: GenericObject) => app.app_name === newApp))
            }
        }, 3000)
    }, [data, newApp])

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
                ) : Array.isArray(data) && data.length ? (
                    <>
                        <h1 className={classes.h1}>LLM Applications</h1>
                        <Divider className={classes.divider} />
                        <div className={classes.cardsList}>
                            {Array.isArray(data) && (
                                <>
                                    {data.map((app: any, index: number) => (
                                        <div key={index}>
                                            <AppCard
                                                appName={app.app_name}
                                                key={index}
                                                index={index}
                                            />
                                        </div>
                                    ))}
                                    <Card
                                        className={classes.createCard}
                                        onClick={showCreateAppModal}
                                    >
                                        <Card.Meta
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
            <Modal
                title="Input app name"
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
                    <div className={classes.modalError}>
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}
                <Button
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
