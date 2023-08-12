import {PlusOutlined} from "@ant-design/icons"
import {Card, Col, Input, Modal, Row, Typography, notification} from "antd"
import {useState, useEffect} from "react"
import YouTube from "react-youtube"
import { Template, AppTemplate, TemplateImage } from "@/lib/Types"
import { isAppNameInputValid } from "@/lib/helpers/utils"
import {fetchApps, getTemplates, pullTemplateImage, startTemplate} from "@/lib/services/api"
import AppTemplateCard from "./AppTemplateCard"


export default function CreateApp() {
    const {Text, Title} = Typography

    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isCreateAppFromTemplateModalOpen, setIsCreateAppFromTemplateModalOpen] = useState(false)
    const [isWriteAppModalOpen, setIsWriteAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])
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

    const handleCreateAppFromTemplateModalCancel = () => {
        setIsCreateAppFromTemplateModalOpen(false)
        setIsCreateAppModalOpen(true)
    }

    const handleWriteApppModalCancel = () => {
        setIsWriteAppModalOpen(false)
    }

    const handleCreateAppModalCancel = () => {
        setIsCreateAppModalOpen(false)
    }

    useEffect(() => {
        const fetchTemplates = async () => {
            const data = await getTemplates()
            setTemplates(data);
        }

        fetchTemplates()
    }, []);

    const fetchTemplateImage = async (image_name: string) => {
        const response = await pullTemplateImage(image_name)
        if (response) {
            return response
        } else {
            notification.error({
                message: 'Template Selection',
                description: 'Failed to fetch template image. Please try again later.',
                duration: 5,
            });
            return null
        }
    }

    const retrieveOpenAIKey = () => {
        const apiKey = localStorage.getItem('openAiToken')

        if (apiKey) {
            return apiKey
        } else {
            notification.error({
                message: 'OpenAI API Key Missing',
                description: 'Please provide your OpenAI API key to access this feature.',
                duration: 5,
            });
            return null
        }
    }

    const createAppVariantFromTemplateImage = async (app_name: string, image_id: string, image_tag: string) => {

        const OpenAIKey = retrieveOpenAIKey() as string
        const variantData: AppTemplate = {
            app_name: app_name,
            image_id: image_id,
            image_tag: image_tag,
            env_vars: {
                OPENAI_API_KEY: OpenAIKey
            }
        }
        const response  = await startTemplate(variantData)
        if (response.status == 200) {
            notification.success({
                message: 'Template Selection',
                description: 'App has been created and will begin to run.',
                duration: 15,
            });
            return response
        } else {
            notification.error({
                message: 'Template Selection',
                description: 'An error occured when trying to start the variant. Ensure that you do not have a variant with the same app name.',
                duration: 5,
            });
            setFetchingTemplate(false)
        }
    }

    const handleTemplateCardClick = async (image_name: string) => {
        setFetchingTemplate(true)
        
        const data: TemplateImage = await fetchTemplateImage(image_name)
        await createAppVariantFromTemplateImage(newApp, data.image_id, data.image_tag)

        setNewApp("")
        handleCreateAppFromTemplateModalCancel()
        handleCreateAppModalCancel()
        setFetchingTemplate(false)
        
    };

    const { data, error, isLoading } = fetchApps();
    useEffect(() => {
        if (data) {
            setAppNameExist(data.some(app => app.app_name === newApp));
        }
    }, [data, newApp]);

    return (
        <div>
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
                <Input
                    placeholder="New app name (e.g., chat-app)"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                    style={{margin: "10px"}}
                />
                {appNameExist && (
                    <div style={{ color: 'red', marginLeft: "10px" }}>
                        App name already exist
                    </div>
                )}
                {newApp.length > 0 && !isAppNameInputValid(newApp) && (
                    <div style={{ color: 'red', marginLeft: "10px" }}>
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}

                <div
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        justifyContent: 'space-evenly',
                        padding: '10px',
                    }}

                >
                    {templates.map(template => (
                        <div
                            key={template.id}
                            style={{
                                cursor: newApp.length > 0 && isAppNameInputValid(newApp) ? 'pointer' : 'not-allowed',
                            }}
                        >
                            <AppTemplateCard 
                                title={template.image.name} 
                                onClick={() => {
                                    if (appNameExist) {
                                        notification.warning({
                                            message: 'Template Selection',
                                            description: 'App name already exists. Please choose a different name.',
                                            duration: 3,
                                        });
                                    } else if (fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
                                        notification.info({
                                            message: 'Template Selection',
                                            description: 'The template image is currently being fetched. Please wait...',
                                            duration: 3,
                                        });
                                    } else if (!fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
                                        notification.info({
                                            message: 'Template Selection',
                                            description: 'Fetching template image...',
                                            duration: 10,
                                        });
                                        handleTemplateCardClick(template.image.name);
                                    } else {
                                        notification.warning({
                                            message: 'Template Selection',
                                            description: 'Please provide a valid app name to choose a template.',
                                            duration: 3,
                                        });
                                    }
                                }}
                            />
                        </div>
                    ))}
                </div>
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
    )
}
