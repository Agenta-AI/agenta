import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    BarChartOutlined,
    LineChartOutlined,
    QuestionOutlined,
    DashboardOutlined,
    LockOutlined,
} from "@ant-design/icons"
import {Layout, Menu, Space, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"

const {Sider} = Layout

const useStyles = createUseStyles({
    sliderContainer: {
        display: "flex",
        flexDirection: "column",
        height: "100%",

        "& > div:nth-of-type(1)": {
            marginTop: "20px",
            marginBottom: "20px",
            marginRight: "20px",
            display: "flex",
            justifyContent: "center",
        },
        "& > div:nth-of-type(2)": {
            display: "flex",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 1,
        },
    },
    menuContainer: {
        borderRight: 0,
    },
    menuContainer2: {
        paddingBottom: 24,
        borderRight: 0,
    },
    menuLinks: {
        width: "100%",
    },
})

const Sidebar: React.FC = () => {
    const classes = useStyles()
    const router = useRouter()
    const {app_name} = router.query

    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    const {
        token: {colorBgContainer},
    } = theme.useToken()

    const {appTheme, toggleAppTheme} = useAppTheme()

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
            <div className={classes.sliderContainer}>
                <div>
                    <Logo />
                </div>

                <div>
                    <Menu
                        mode="inline"
                        selectedKeys={initialSelectedKeys}
                        className={classes.menuContainer}
                    >
                        <Menu.Item key="apps" icon={<AppstoreOutlined />}>
                            <Tooltip
                                placement="right"
                                title="Create new applications or switch between your existing projects."
                            >
                                <Link
                                    data-cy="app-management-link"
                                    href={getNavigationPath("apps")}
                                    className={classes.menuLinks}
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
                                            className={classes.menuLinks}
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
                                            className={classes.menuLinks}
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
                                            className={classes.menuLinks}
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
                                            className={classes.menuLinks}
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
                                            className={classes.menuLinks}
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

                    <Menu
                        mode="vertical"
                        className={classes.menuContainer2}
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
                                    className={classes.menuLinks}
                                >
                                    <Space>
                                        <span>API keys</span>
                                    </Space>
                                </Link>
                            </Tooltip>
                        </Menu.Item>
                        <Menu.Item
                            key="theme"
                            icon={<DashboardOutlined />}
                            onClick={toggleAppTheme}
                        >
                            <span>{appTheme === "light" ? "Dark mode" : "Light mode"}</span>
                        </Menu.Item>
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
            </div>
        </Sider>
    )
}

export default Sidebar
