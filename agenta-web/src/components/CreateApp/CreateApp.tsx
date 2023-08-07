import {PlusOutlined} from "@ant-design/icons"
import {Card, Col, Input, Modal, Row, Typography} from "antd"
import {useState} from "react"
import YouTube from "react-youtube"
import AppTemplateCard from "./AppTemplateCard"

export default function CreateApp() {
    const {Text, Title} = Typography

    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isCreateAppFromTemplateModalOpen, setIsCreateAppFromTemplateModalOpen] = useState(false)
    const [isWriteAppModalOpen, setIsWriteAppModalOpen] = useState(false)

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
                    placeholder="New app name"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                    style={{margin: "10px"}}
                />
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
                    <AppTemplateCard title="first" />
                    <AppTemplateCard title="second" />
                    <AppTemplateCard title="third" />
                    <AppTemplateCard title="fourth" />
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
