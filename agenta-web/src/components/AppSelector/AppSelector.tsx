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
    Col,
    Row,
    Typography,
} from "antd"
import useSWR from "swr"
import AppCard from "./AppCard"
import YouTube from "react-youtube"
import {Template, AppTemplate, TemplateImage} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {CloseCircleFilled} from "@ant-design/icons"
import TipsAndFeatures from "./TipsAndFeatures"
import AppTemplateCard from "../CreateApp/AppTemplateCard"
import {isAppNameInputValid} from "@/lib/helpers/utils"
import {fetchApps, getTemplates, pullTemplateImage, startTemplate} from "@/lib/services/api"
import CreateApp from "@/components/CreateApp/CreateApp"

const fetcher = (...args: any[]) => fetch(...args).then((res) => res.json())

const AppSelector: React.FC = () => {
    const router = useRouter()
    const {appTheme} = useAppTheme()
    const {Text, Title} = Typography
    const [newApp, setNewApp] = useState("")
    const [appNameExist, setAppNameExist] = useState(false)

    const [templateMessage, setTemplateMessage] = useState("")
    const [templates, setTemplates] = useState<Template[]>([])
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [isWriteAppModalOpen, setIsWriteAppModalOpen] = useState(false)
    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [templateName, setTemplateName] = useState<string | undefined>(undefined)
    const [isInputTemplateModalOpen, setIsInputTemplateModalOpen] = useState<boolean>(false)
    const [isCreateAppFromTemplateModalOpen, setIsCreateAppFromTemplateModalOpen] = useState(false)


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
        }, 8000)
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

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div
                style={{
                    maxWidth: "1000px",
                    margin: "10px auto 5%",
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
                        <h1
                            style={{
                                fontSize: 24,
                                borderBottom: "1px solid #0e9c1a",
                                paddingBottom: "1rem",
                            }}
                        >
                            LLM Applications
                        </h1>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 10,
                            }}
                        >
                            {Array.isArray(data) &&
                                data.map((app: any, index: number) => (
                                    <div key={index}>
                                        <AppCard appName={app.app_name} key={index} index={index} />
                                    </div>
                                ))}
                        </div>

                        <Card
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
                                title={<div style={{textAlign: "center"}}>Create New App</div>}
                                avatar={<PlusOutlined size={24} />}
                            />
                        </Card>
                        <TipsAndFeatures />
                    </>
                ) : (
                    <>
                        <div>
                            <h1 style={{fontSize: "42px", margin: "20px 0"}}>
                                Welcome to <span style={{color: "#0e9c1a"}}>Agenta</span>
                            </h1>
                            <h2
                                style={{
                                    fontSize: "24px",
                                    margin: "20px 0",
                                    borderBottom: "1px solid #0e9c1a",
                                    paddingBottom: "1rem",
                                }}
                            >
                                The developer-first open source LLMOps platform.
                            </h2>
                        </div>
                        <div
                            style={{
                                padding: "0 20px",
                                lineHeight: 1.7,
                                marginBottom: "2rem",
                            }}
                        >
                            <p>
                                Agenta is an open-source developer first LLMOps platform to
                                streamline the process of building LLM-powered applications.
                                Building LLM-powered apps is an iterative process with lots of
                                prompt-engineering and testing multiple variants.
                                <br />
                                Agenta brings the CI/CD platform to this process by enabling you to
                                quickly iterate, experiment, evaluate, and optimize your LLM apps.
                                All without imposing any restrictions on your choice of framework,
                                library, or model.
                                <br />
                            </p>

                            <div>
                                <span
                                    style={{
                                        fontWeight: 600,
                                        fontSize: 15,
                                        textTransform: "uppercase",
                                    }}
                                >
                                    Read{" "}
                                    <a href="https://docs.agenta.ai/introduction" target="_blank">
                                        Documentation
                                    </a>{" "}
                                    on how to get started.
                                </span>
                            </div>
                        </div>
                    </>
                )}
                <CreateApp />
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
                                    style={{
                                        textAlign: "center",
                                        height: "180px",
                                        cursor: "pointer",
                                    }}
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
                            <div style={{color: "red", marginLeft: "10px"}}>
                                App name already exist
                            </div>
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
            </div>
        </ConfigProvider>
    )
}

export default AppSelector
