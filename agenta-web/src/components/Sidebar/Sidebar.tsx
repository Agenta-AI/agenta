import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    FileTextOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    BarChartOutlined,
    LineChartOutlined,
    MonitorOutlined,
    UserOutlined,
    QuestionOutlined,
    GlobalOutlined,
} from "@ant-design/icons"
import {Avatar, Layout, Menu, Space, Tag, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"

const {Sider} = Layout

const Sidebar: React.FC = () => {
    const router = useRouter()
    const {app_name} = router.query

    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    const {
        token: {colorBgContainer},
    } = theme.useToken()

    let initialSelectedKeys: string[] = []
    if (typeof page_name === "string") {
        initialSelectedKeys = [page_name]
    } else if (Array.isArray(page_name)) {
        initialSelectedKeys = page_name
    } else if (typeof page_name === "undefined") {
        initialSelectedKeys = ["apps"]
    }
    const [selectedKeys, setSelectedKeys] = useState(initialSelectedKeys)

    useEffect(() => {
        setSelectedKeys(initialSelectedKeys)
    }, [page_name])

    const navigate = (path: string) => {
        if (path === "apps") {
            router.push(`/apps`)
        } else {
            router.push(`/apps/${app_name}/${path}`)
        }
    }

    return (
        <Sider
            theme="light"
            style={{
                paddingLeft: "10px",
                paddingRight: "10px",
                background: colorBgContainer,
                border: "0.01px solid #ddd",
                overflow: "hidden",
            }}
            width={225}
        >
            <div style={{display: "flex", flexDirection: "column", height: "100%"}}>
                <div
                    style={{
                        marginTop: "20px",
                        marginBottom: "20px",
                        marginRight: "20px",
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    <Logo />
                </div>
                <Menu mode="inline" selectedKeys={initialSelectedKeys} style={{borderRight: 0}}>
                    <Menu.Item
                        key="apps"
                        icon={<AppstoreOutlined />}
                        onClick={() => navigate("apps")}
                    >
                        <Tooltip
                            placement="right"
                            title="Create new applications or switch between your existing projects."
                        >
                            <div style={{width: "100%"}}>App Management</div>
                        </Tooltip>
                    </Menu.Item>
                    {page_name && (
                        <>
                            <Menu.Item
                                key="playground"
                                icon={<RocketOutlined />}
                                onClick={() => navigate("playground")}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                >
                                    <div style={{width: "100%"}}>Playground</div>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="testsets"
                                icon={<DatabaseOutlined />}
                                onClick={() => navigate("testsets")}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Create and manage testsets for evaluation purposes."
                                >
                                    <div style={{width: "100%"}}>Test Sets</div>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="evaluations"
                                icon={<LineChartOutlined />}
                                onClick={() => navigate("evaluations")}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                >
                                    <div style={{width: "100%"}}>Evaluate</div>
                                </Tooltip>
                            </Menu.Item>
                            <Menu.Item
                                key="results"
                                icon={<BarChartOutlined />}
                                onClick={() => navigate("results")}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Analyze the evaluation outcomes to determine the most effective variants."
                                >
                                    <div style={{width: "100%"}}>Results</div>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="endpoints"
                                icon={<CloudUploadOutlined />}
                                onClick={() => navigate("endpoints")}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Monitor production logs to ensure seamless operations."
                                >
                                    <div style={{width: "100%"}}>
                                        <Space>
                                            <span>Endpoints</span>
                                        </Space>
                                    </div>
                                </Tooltip>
                            </Menu.Item>
                        </>
                    )}
                </Menu>

                <div style={{flex: 1}} />

                <Menu
                    mode="vertical"
                    style={{paddingBottom: 40, borderRight: 0}}
                    selectedKeys={selectedKeys}
                >
                    <Menu.Item
                        key="help"
                        icon={<QuestionOutlined />}
                        onClick={() => window.open("https://docs.agenta.ai", "_blank")}
                    >
                        Help
                    </Menu.Item>
                    {/* <Menu.Item key="user">
                        <Space>
                            <Avatar size="small" style={{ backgroundColor: '#87d068' }} icon={<UserOutlined />} />
                            <span>Foulen</span>
                        </Space>

                    </Menu.Item> */}
                </Menu>
            </div>
        </Sider>
    )
}

export default Sidebar
