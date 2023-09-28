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
import {Layout, Menu, Space, Tooltip, theme, Dropdown} from "antd"

import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"

type StyleProps = {
    themeMode: "system" | "dark" | "light"
    colorBgContainer: string
}

type MenuItem = {
    key: string
    label?: string
    onClick: () => void
}

const {Sider} = Layout

const useStyles = createUseStyles({
    sidebar: ({themeMode, colorBgContainer}: StyleProps) => ({
        paddingLeft: "10px",
        paddingRight: "10px",
        background: `${colorBgContainer} !important`,
        border: `0.01px solid ${themeMode === "dark" ? "#222" : "#ddd"}`,
        height: "100vh",
        position: "fixed !important",
    }),
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
        borderRight: "0 !important",
    },
    menuContainer2: {
        paddingBottom: 24,
        borderRight: "0 !important",
    },
    menuLinks: {
        width: "100%",
    },
    sideIcons: {
        paddingLeft: "20px",
    },
    optionSideIcon: {
        paddingLeft: "20px",
    },
})

const Sidebar: React.FC = () => {
    const {appTheme, toggleAppTheme} = useAppTheme()
    const {
        token: {colorBgContainer},
    } = theme.useToken()
    const router = useRouter()
    const appId = router.query.app_id as string
    const classes = useStyles({themeMode: appTheme, colorBgContainer} as StyleProps)
    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    let initialSelectedKeys: string[] = []
    if (typeof page_name === "string") {
        initialSelectedKeys = [page_name]
    } else if (Array.isArray(page_name)) {
        initialSelectedKeys = page_name
    } else if (typeof page_name === "undefined") {
        initialSelectedKeys = ["apps"]
    }
    const [selectedKeys, setSelectedKeys] = useState(initialSelectedKeys)
    const [themeKey, setTheme] = useState(() => {
        const savedTheme = localStorage.getItem("agenta-theme")

        if (!savedTheme) {
            toggleAppTheme("system")
            return 0
        }

        return savedTheme === "dark" ? 1 : 2
    })
    const items: MenuItem[] = [
        {
            key: "0",
            label: "System",
            onClick: () => {
                setTheme(0)
                toggleAppTheme("system")
            },
        },
        {
            key: "1",
            label: "Dark Mode",
            onClick: () => {
                setTheme(1)
                toggleAppTheme("dark")
            },
        },

        {
            key: "2",
            label: "Light Mode",
            onClick: () => {
                setTheme(2)
                toggleAppTheme("light")
            },
        },
    ] as any[]

    useEffect(() => {
        setSelectedKeys(initialSelectedKeys)
    }, [page_name])

    const getNavigationPath = (path: string) => {
        if (path === "apps") {
            return "/apps"
        } else if (path === "keys") {
            return "/apikeys"
        } else {
            return `/apps/${appId}/${path}`
        }
    }

    return (
        <Sider theme="light" className={classes.sidebar} width={225}>
            <div className={classes.sliderContainer}>
                <div>
                    <Link data-cy="app-management-link" href={getNavigationPath("apps")}>
                        <Logo />
                    </Link>
                </div>
                <ErrorBoundary fallback={<div />}>
                    <div>
                        <Menu
                            mode="inline"
                            selectedKeys={initialSelectedKeys}
                            className={classes.menuContainer}
                        >
                            <Tooltip
                                placement="right"
                                title="Create new applications or switch between your existing projects."
                            >
                                <Menu.Item
                                    key="apps"
                                    icon={<AppstoreOutlined className={classes.sideIcons} />}
                                >
                                    <Link
                                        data-cy="app-management-link"
                                        href={getNavigationPath("apps")}
                                        className={classes.menuLinks}
                                    >
                                        App Management
                                    </Link>
                                </Menu.Item>
                            </Tooltip>
                            {page_name && (
                                <>
                                    <Tooltip
                                        placement="right"
                                        key="playground"
                                        title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                    >
                                        <Menu.Item
                                            icon={
                                                <RocketOutlined
                                                    className={classes.optionSideIcon}
                                                />
                                            }
                                        >
                                            <Link
                                                data-cy="app-playground-link"
                                                href={getNavigationPath("playground")}
                                                className={classes.menuLinks}
                                            >
                                                Playground
                                            </Link>
                                        </Menu.Item>
                                    </Tooltip>

                                    <Tooltip
                                        placement="right"
                                        title="Create and manage testsets for evaluation purposes."
                                    >
                                        <Menu.Item
                                            key="testsets"
                                            icon={
                                                <DatabaseOutlined
                                                    className={classes.optionSideIcon}
                                                />
                                            }
                                        >
                                            <Link
                                                data-cy="app-testsets-link"
                                                href={getNavigationPath("testsets")}
                                                className={classes.menuLinks}
                                            >
                                                Test Sets
                                            </Link>
                                        </Menu.Item>
                                    </Tooltip>

                                    <Tooltip
                                        placement="right"
                                        title="Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                    >
                                        <Menu.Item
                                            key="evaluations"
                                            icon={
                                                <LineChartOutlined
                                                    className={classes.optionSideIcon}
                                                />
                                            }
                                        >
                                            <Link
                                                data-cy="app-evaluations-link"
                                                href={getNavigationPath("evaluations")}
                                                className={classes.menuLinks}
                                            >
                                                Evaluate
                                            </Link>
                                        </Menu.Item>
                                    </Tooltip>

                                    <Tooltip
                                        placement="right"
                                        title="Monitor production logs to ensure seamless operations."
                                    >
                                        <Menu.Item
                                            key="endpoints"
                                            icon={
                                                <CloudUploadOutlined
                                                    className={classes.optionSideIcon}
                                                />
                                            }
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
                                        </Menu.Item>
                                    </Tooltip>
                                </>
                            )}
                        </Menu>

                        <Menu
                            mode="vertical"
                            className={classes.menuContainer2}
                            selectedKeys={selectedKeys}
                        >
                            <Tooltip
                                placement="right"
                                key="apikeys"
                                title="Your api keys that are used in applications"
                            >
                                <Menu.Item icon={<LockOutlined />}>
                                    <Link
                                        data-cy="apikeys-link"
                                        href={getNavigationPath("keys")}
                                        className={classes.menuLinks}
                                    >
                                        <Space>
                                            <span>API keys</span>
                                        </Space>
                                    </Link>
                                </Menu.Item>
                            </Tooltip>

                            <Menu.Item key="theme" icon={<DashboardOutlined />}>
                                <Dropdown menu={{items}} trigger={["click"]}>
                                    <Space>
                                        <span>Theme: {items[themeKey]?.label}</span>
                                    </Space>
                                </Dropdown>
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
                </ErrorBoundary>
            </div>
        </Sider>
    )
}

export default Sidebar
