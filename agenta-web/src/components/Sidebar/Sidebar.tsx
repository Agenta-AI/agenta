import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    BarChartOutlined,
    LineChartOutlined,
    LogoutOutlined,
    QuestionOutlined,
    DashboardOutlined,
    LockOutlined,
} from "@ant-design/icons"
import {Layout, Menu, Space, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"
import Link from "next/link"
import {ISession} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {signOut} from "supertokens-auth-react/recipe/thirdpartypasswordless"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

const {Sider} = Layout

const Sidebar: React.FC = () => {
    const router = useRouter()
    const {app_name} = router.query

    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    const {
        token: {colorBgContainer},
    } = theme.useToken()

    const {appTheme, toggleAppTheme} = useAppTheme()
    const tokenSession: ISession = useSessionContext()

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
            return "/apps"
        } else if (path === "keys") {
            return "/apikeys"
        } else {
            return `/apps/${app_name}/${path}`
        }
    }

    const handleLogout = async () => {
        await signOut().finally(() => {
            router.push("/auth")
        })
    }

    return (
        <Sider
            theme="light"
            style={{
                paddingLeft: "10px",
                paddingRight: "10px",
                background: colorBgContainer,
                border: `0.01px solid ${appTheme === "dark" ? "#222" : "#ddd"}`,
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
                    }}
                >
                    <Logo />
                </div>
                <Menu mode="inline" selectedKeys={initialSelectedKeys} style={{borderRight: 0}}>
                    <Menu.Item key="apps" icon={<AppstoreOutlined />}>
                        <Tooltip
                            placement="right"
                            title="Create new applications or switch between your existing projects."
                        >
                            <Link
                                data-cy="app-management-link"
                                href={getNavigationPath("apps")}
                                style={{width: "100%"}}
                            >
                                App Management
                            </Link>
                        </Tooltip>
                    </Menu.Item>
                    {page_name && (
                        <>
                            <Menu.Item key="playground" icon={<RocketOutlined />}>
                                <Tooltip
                                    placement="right"
                                    title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                >
                                    <Link
                                        data-cy="app-playground-link"
                                        href={getNavigationPath("playground")}
                                        style={{width: "100%"}}
                                    >
                                        Playground
                                    </Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item key="testsets" icon={<DatabaseOutlined />}>
                                <Tooltip
                                    placement="right"
                                    title="Create and manage testsets for evaluation purposes."
                                >
                                    <Link
                                        data-cy="app-testsets-link"
                                        href={getNavigationPath("testsets")}
                                        style={{width: "100%"}}
                                    >
                                        Test Sets
                                    </Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item key="evaluations" icon={<LineChartOutlined />}>
                                <Tooltip
                                    placement="right"
                                    title="Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                >
                                    <Link
                                        data-cy="app-evaluations-link"
                                        href={getNavigationPath("evaluations")}
                                        style={{width: "100%"}}
                                    >
                                        Evaluate
                                    </Link>
                                </Tooltip>
                            </Menu.Item>
                            <Menu.Item key="results" icon={<BarChartOutlined />}>
                                <Tooltip
                                    placement="right"
                                    title="Analyze the evaluation outcomes to determine the most effective variants."
                                >
                                    <Link
                                        data-cy="app-results-link"
                                        href={getNavigationPath("results")}
                                        style={{width: "100%"}}
                                    >
                                        Results
                                    </Link>
                                </Tooltip>
                            </Menu.Item>

                            <Menu.Item key="endpoints" icon={<CloudUploadOutlined />}>
                                <Tooltip
                                    placement="right"
                                    title="Monitor production logs to ensure seamless operations."
                                >
                                    <Link
                                        data-cy="app-endpoints-link"
                                        href={getNavigationPath("endpoints")}
                                        style={{width: "100%"}}
                                    >
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
                    style={{paddingBottom: 24, borderRight: 0}}
                    selectedKeys={selectedKeys}
                >
                    <Menu.Item key="apikeys" icon={<LockOutlined />}>
                        <Tooltip
                            placement="right"
                            title="Your api keys that are used in applications"
                        >
                            <Link
                                data-cy="apikeys-link"
                                href={getNavigationPath("keys")}
                                style={{width: "100%"}}
                            >
                                <Space>
                                    <span>API keys</span>
                                </Space>
                            </Link>
                        </Tooltip>
                    </Menu.Item>
                    <Menu.Item key="theme" icon={<DashboardOutlined />} onClick={toggleAppTheme}>
                        <span>{appTheme === "light" ? "Dark mode" : "Light mode"}</span>
                    </Menu.Item>
                    {tokenSession.doesSessionExist && (
                        <Menu.Item key="help" icon={<LogoutOutlined />} onClick={handleLogout}>
                            <span>Logout</span>
                        </Menu.Item>
                    )}
                    <Menu.Item key="help" icon={<QuestionOutlined />}>
                        <Link href="https://docs.agenta.ai" target="_blank">
                            Help
                        </Link>
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
