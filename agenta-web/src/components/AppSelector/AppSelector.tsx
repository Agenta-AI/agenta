import {useState, useEffect} from "react"
import {useRouter} from "next/router"
import {PlusOutlined} from "@ant-design/icons"
import {Input, Modal, ConfigProvider, theme, Spin, Card, Button, notification, Divider} from "antd"
import AppCard from "./AppCard"
import {Template, AppTemplate, TemplateImage} from "@/lib/Types"
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

const useStyles = createUseStyles({
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
        "& .ant-card-meta-title": {
            color: "#FFFFFF",
        },
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
            env_vars: {
                OPENAI_API_KEY: api_key,
            },
        }
        const response = await startTemplate(variantData)
        if (response.status == 200) {
            notification.success({
                message: "Template Selection",
                description: "App has been created and will begin to run.",
                duration: 5,
            })
            return response
        } else {
            notification.error({
                message: "Template Selection",
                description: "An error occured when trying to start the variant.",
                duration: 5,
            })
            setFetchingTemplate(false)
            return
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
            await createAppVariantFromTemplateImage(
                newApp,
                data.image_id,
                data.image_tag,
                OpenAIKey,
            ).finally(() => {
                handleCreateAppFromTemplateModalCancel()
                handleCreateAppModalCancel()
                handleNavigation()
            })
        }
    }

    const {data, error, isLoading} = fetchApps()
    useEffect(() => {
        setTimeout(() => {
            if (data) {
                setAppNameExist(data.some((app) => app.app_name === newApp))
            }
        }, 3000)
    }, [data, newApp])

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div
                style={{
                    maxWidth: "1450px",
                    marginTop: 10,
                    width: "100%",
                    color: appTheme === "dark" ? "#fff" : "#000",
                }}
            >
                {isLoading ? (
                    <div className="appSelectorMssg">
                        <Spin />
                        <h1>loading...</h1>
                    </div>
                ) : error ? (
                    <div className="appSelectorMssg">
                        <CloseCircleFilled style={{fontSize: 20, color: "red"}} />
                        <h1>failed to load</h1>
                    </div>
                ) : Array.isArray(data) && data.length ? (
                    <>
                        <h1 style={{fontSize: 22}}>LLM Applications</h1>
                        <Divider
                            style={{
                                marginTop: 0,
                                borderColor:
                                    appTheme === "dark"
                                        ? "rgba(256, 256, 256, 0.2)"
                                        : "rgba(5, 5, 5, 0.15)",
                            }}
                        />
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
                                        style={{
                                            width: 300,
                                            height: 120,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                        }}
                                        onClick={showCreateAppModal}
                                    >
                                        <Card.Meta
                                            style={{
                                                height: "90%",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-evenly",
                                            }}
                                            title={
                                                <div style={{textAlign: "center"}}>
                                                    Create New App
                                                </div>
                                            }
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
                bodyStyle={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    marginTop: 20,
                }}
            >
                <Input
                    placeholder="New app name (e.g., chat-app)"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                    disabled={fetchingTemplate}
                />
                {appNameExist && (
                    <div style={{color: "red", marginLeft: "10px"}}>App name already exist</div>
                )}
                {newApp.length > 0 && !isAppNameInputValid(newApp) && (
                    <div style={{color: "red", marginLeft: "10px"}}>
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}
                <Button
                    style={{alignSelf: "flex-end"}}
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
                            handleTemplateCardClick(templateName)
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
