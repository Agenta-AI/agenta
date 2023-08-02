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
    DashboardOutlined,
} from "@ant-design/icons"
import {Avatar, Layout, Menu, Space, Tag, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"
import Link from 'next/link'
import { useAppTheme } from '../Layout/ThemeContextProvider'

const {Sider} = Layout

const Sidebar: React.FC = () => {
    const router = useRouter()
    const {app_name} = router.query

    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    const {
        token: {colorBgContainer},
    } = theme.useToken()

    const { appTheme, toggleAppTheme } = useAppTheme()

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

    const getNavigationPath = (path: string) => {
        if (path === "apps") {
            return '/apps'
        } else {
            return `/apps/${app_name}/${path}`
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
                height: "100vh",
                position: "fixed",
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
                        background: "#ffffff77",
                        borderRadius: "5px"
                    }}
                >
                    <Logo />
                </div>
                <Menu mode="inline" selectedKeys={initialSelectedKeys} style={{borderRight: 0}}>
                    <Menu.Item
                        key="apps"
                        icon={<AppstoreOutlined />}
                    >
                        <Tooltip
                            placement="right"
                            title="Create new applications or switch between your existing projects."
                        >
                            <Link href={getNavigationPath('apps')} style={{width: "100%"}}>App Management</Link>
                        </Tooltip>
                    </Menu.Item>
                    {page_name && (
                        <>
                            <Menu.Item
                                key="playground"
                                icon={<RocketOutlined />}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                >
                                    <Link href={getNavigationPath('playground')} style={{width: "100%"}}>Playground</Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="testsets"
                                icon={<DatabaseOutlined />}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Create and manage testsets for evaluation purposes."
                                >
                                    <Link href={getNavigationPath('testsets')} style={{width: "100%"}}>Test Sets</Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="evaluations"
                                icon={<LineChartOutlined />}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                >
                                    <Link href={getNavigationPath('evaluations')} style={{width: "100%"}}>Evaluate</Link>
                                </Tooltip>
                            </Menu.Item>
                            <Menu.Item
                                key="results"
                                icon={<BarChartOutlined />}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Analyze the evaluation outcomes to determine the most effective variants."
                                >
                                    <Link href={getNavigationPath('results')} style={{width: "100%"}}>Results</Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item
                                key="endpoints"
                                icon={<CloudUploadOutlined />}
                            >
                                <Tooltip
                                    placement="right"
                                    title="Monitor production logs to ensure seamless operations."
                                >
                                    <Link href={getNavigationPath('endpoints')} style={{width: "100%"}}>
                                        <Space>
                                            <span>Endpoints</span>
                                        </Space>
                                    </Link>
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
                        key="theme"
                        icon={<DashboardOutlined />}
                        onClick={toggleAppTheme}
                    >
                        <span>{appTheme === 'light' ? 'Dark mode' : 'Light mode'}</span>
                    </Menu.Item>
                    <Menu.Item
                        key="help"
                        icon={<QuestionOutlined />}
                    >
                        <Link href='https://docs.agenta.ai' target='_blank'>Help</Link>
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
