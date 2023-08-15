import {PlusOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Input,
    Modal,
    Row,
    Typography,
    notification,
    theme,
    ConfigProvider,
} from "antd"
import {useState, useEffect} from "react"
import YouTube from "react-youtube"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {Template, AppTemplate, TemplateImage} from "@/lib/Types"
import {isAppNameInputValid} from "@/lib/helpers/utils"
import {fetchApps, getTemplates, pullTemplateImage, startTemplate} from "@/lib/services/api"
import AppTemplateCard from "./AppTemplateCard"
import {useRouter} from "next/router"

export default function CreateApp() {
    const {Text, Title} = Typography

    const router = useRouter()

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
            duration: 15,
        })
        setTimeout(() => {
            router.push(`/apps/${newApp}/playground`)
        }, 6000)
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
        if (response && response.image_tag && response.image_id) {
            return response
        } else {
            notification.error({
                message: "Template Selection",
                description: "Failed to fetch template image. Please try again later.",
                duration: 10,
            })
            return null
        }
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
        await createAppVariantFromTemplateImage(
            newApp,
            data.image_id,
            data.image_tag,
            OpenAIKey,
        ).finally(() => {
            handleCreateAppFromTemplateModalCancel()
            handleCreateAppModalCancel()
            setFetchingTemplate(false)

            handleInputTemplateModalCancel()
            handleNavigation()
            setNewApp("")
            setTemplateName(undefined)
        })
    }

    const {data, error, isLoading} = fetchApps()

    useEffect(() => {
        if (data) {
            setAppNameExist(data.some((app) => app.app_name === newApp))
        }
    }, [data, newApp])

    const {appTheme} = useAppTheme()

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            {data.length <= 0 && (
                <div
                    className="appSelectorEmpty"
                    style={{
                        padding: "20px",
                        backgroundColor: appTheme === "dark" ? "#111a2c" : "#e6f4ff",
                    }}
                >
                    <h1 style={{fontSize: 20, marginTop: "0px"}}>
                        Get started creating your first LLM App
                    </h1>

                    <p>
                        This guide assumes you have completed the installation process. If not,
                        please follow our{" "}
                        <a href="https://docs.agenta.ai/installation" target="_blank">
                            installation guide
                        </a>
                        .
                    </p>

                    <Button
                        style={{
                            backgroundColor: "#1677ff",
                            border: "none",
                            color: "#fff",
                        }}
                        onClick={showCreateAppModal}
                    >
                        Create New App
                    </Button>
                </div>
            )}

            <div>
                <Modal
                    open={isCreateAppModalOpen}
                    onCancel={handleCreateAppModalCancel}
                    footer={null}
                    title="Add new app"
                    width={"600px"}
                >
                    <Row
                        justify="start"
                        gutter={30}
                        style={{
                            padding: "10px",
                            height: "240px",
                            display: "flex",
                            alignItems: "center",
                        }}
                    >
                        <Col span={12}>
                            <Card
                                style={{
                                    textAlign: "center",
                                    height: "180px",
                                    cursor: "pointer",
                                }}
                                onClick={showCreateAppFromTemplateModal}
                            >
                                <Title style={{fontSize: 20}}>Create From Template</Title>
                                <Text>Create Quickly Simple Prompt Apps From UI</Text>
                            </Card>
                        </Col>
                        <Col span={12}>
                            <Card
                                style={{textAlign: "center", height: "180px", cursor: "pointer"}}
                                onClick={showWriteAppModal}
                            >
                                <Title style={{fontSize: 20}}>Write Your Own App</Title>
                                <Text>Create Complex LLM Apps From Your Code</Text>
                            </Card>
                        </Col>
                    </Row>
                </Modal>
                <Modal
                    title="Add new app from template"
                    open={isCreateAppFromTemplateModalOpen}
                    footer={null}
                    onCancel={handleCreateAppFromTemplateModalCancel}
                    width={"900px"}
                    style={{
                        padding: "10px",
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            justifyContent: "space-evenly",
                            padding: "10px",
                        }}
                    >
                        {templates.length === 0 ? (
                            <div>
                                <AppTemplateCard
                                    title="No Templates Available"
                                    body={templateMessage}
                                    noTemplate={true}
                                    onClick={() => {}}
                                ></AppTemplateCard>
                            </div>
                        ) : (
                            <div
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    justifyContent: "space-evenly",
                                    padding: "10px",
                                }}
                            >
                                {templates.map((template) => (
                                    <div
                                        key={template.id}
                                        style={{
                                            cursor:
                                                newApp.length > 0 && isAppNameInputValid(newApp)
                                                    ? "pointer"
                                                    : "not-allowed",
                                        }}
                                    >
                                        <AppTemplateCard
                                            title={template.image.title}
                                            body={template.image.description}
                                            noTemplate={false}
                                            onClick={() => {
                                                showInputTemplateModal()
                                                setTemplateName(template.image.name)
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Modal>
                <Modal
                    title="Input app name"
                    open={isInputTemplateModalOpen}
                    onCancel={handleInputTemplateModalCancel}
                    width={"500px"}
                    footer={null}
                >
                    <Input
                        placeholder="New app name (e.g., chat-app)"
                        value={newApp}
                        onChange={(e) => setNewApp(e.target.value)}
                        style={{margin: "10px"}}
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
                        style={{margin: "10px"}}
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

                <Modal
                    title="Write your own app"
                    open={isWriteAppModalOpen}
                    footer={null}
                    onCancel={handleWriteApppModalCancel}
                    width={"688px"}
                >
                    <YouTube videoId="8-k1C6ehKuw" loading="lazy" />
                </Modal>
            </div>
        </ConfigProvider>
    )
}
