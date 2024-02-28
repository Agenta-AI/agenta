import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    ReadOutlined,
    PhoneOutlined,
    SettingOutlined,
    LogoutOutlined,
    SlidersOutlined,
    PlayCircleOutlined,
} from "@ant-design/icons"
import {Divider, Layout, Menu, Space, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import AlertPopup from "../AlertPopup/AlertPopup"
import {useProfileData} from "@/contexts/profile.context"
import {isDemo} from "@/lib/helpers/utils"
import {useSession} from "@/hooks/useSession"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {useLocalStorage} from "usehooks-ts"
import Image from "next/image"
import abTesting from "@/media/testing.png"
import singleModel from "@/media/score.png"

type StyleProps = {
    themeMode: "system" | "dark" | "light"
    colorBgContainer: string
}

const {Sider} = Layout

const useStyles = createUseStyles({
    sidebar: ({colorBgContainer}: StyleProps) => ({
        background: `${colorBgContainer} !important`,
        height: "100vh",
        position: "sticky !important",
        bottom: "0px",
        top: "0px",

        "&>div:nth-of-type(2)": {
            background: `${colorBgContainer} !important`,
        },
    }),
    siderWrapper: ({themeMode}: StyleProps) => ({
        border: `0.01px solid ${themeMode === "dark" ? "#222" : "#ddd"}`,
    }),
    evaluationImg: ({themeMode}: StyleProps) => ({
        width: 20,
        height: 20,
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    sliderContainer: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "0 10px",
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
        borderRight: "0 !important",
    },
    menuLinks: {
        width: "100%",
    },
    subMenuContainer: {
        "& .ant-menu-submenu-title": {
            paddingLeft: "16px !important",
        },
    },
})

const Sidebar: React.FC = () => {
    const {appTheme} = useAppTheme()
    const {
        token: {colorBgContainer},
    } = theme.useToken()
    const router = useRouter()
    const appId = router.query.app_id as string
    const classes = useStyles({
        themeMode: appTheme,
        colorBgContainer,
    } as StyleProps)
    const {doesSessionExist, logout} = useSession()

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
    const {user} = useProfileData()
    const [collapsed, setCollapsed] = useLocalStorage("sidebarCollapsed", false)

    useEffect(() => {
        setSelectedKeys(initialSelectedKeys)
    }, [page_name])

    const getNavigationPath = (path: string) => {
        if (path === "apps") {
            return "/apps"
        } else {
            return `/apps/${appId}/${path}`
        }
    }

    const handleLogout = () => {
        AlertPopup({
            title: "Logout",
            message: "Are you sure you want to logout?",
            onOk: logout,
        })
    }

    const OrgsListSubMenu = dynamicComponent("OrgsListSubMenu/OrgsListSubMenu")

    return (
        <div className={classes.siderWrapper}>
            <Sider
                theme={appTheme}
                className={classes.sidebar}
                width={225}
                collapsible
                collapsed={collapsed}
                onCollapse={(value) => setCollapsed(value)}
            >
                <div className={classes.sliderContainer}>
                    <div>
                        <Link data-cy="app-management-link" href={getNavigationPath("apps")}>
                            <Logo isOnlyIconLogo={collapsed} />
                        </Link>
                    </div>
                    <ErrorBoundary fallback={<div />}>
                        <div>
                            <Menu
                                mode="vertical"
                                selectedKeys={initialSelectedKeys}
                                className={classes.menuContainer}
                            >
                                <Tooltip
                                    key="apps"
                                    placement="right"
                                    title={
                                        !collapsed
                                            ? "Create new applications or switch between your existing projects."
                                            : ""
                                    }
                                >
                                    <Menu.Item icon={<AppstoreOutlined />}>
                                        <Link
                                            data-cy="app-management-link"
                                            href={getNavigationPath("apps")}
                                            className={classes.menuLinks}
                                        >
                                            {collapsed
                                                ? "Create new applications or switch between your existing projects."
                                                : "App Management"}
                                        </Link>
                                    </Menu.Item>
                                </Tooltip>
                                {page_name && (
                                    <>
                                        <Tooltip
                                            placement="right"
                                            key="playground"
                                            title={
                                                !collapsed
                                                    ? "Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                                    : ""
                                            }
                                        >
                                            <Menu.Item icon={<RocketOutlined />}>
                                                <Link
                                                    data-cy="app-playground-link"
                                                    href={getNavigationPath("playground")}
                                                    className={classes.menuLinks}
                                                >
                                                    {collapsed
                                                        ? "Experiment with real data and optimize your parameters including prompts, methods, and configuration settings."
                                                        : "Playground"}
                                                </Link>
                                            </Menu.Item>
                                        </Tooltip>

                                        <Tooltip
                                            placement="right"
                                            title={
                                                !collapsed
                                                    ? "Create and manage testsets for evaluation purposes."
                                                    : ""
                                            }
                                            key="testsets"
                                        >
                                            <Menu.Item icon={<DatabaseOutlined />}>
                                                <Link
                                                    data-cy="app-testsets-link"
                                                    href={getNavigationPath("testsets")}
                                                    className={classes.menuLinks}
                                                >
                                                    {collapsed
                                                        ? "Create and manage testsets for evaluation purposes."
                                                        : "Test Sets"}
                                                </Link>
                                            </Menu.Item>
                                        </Tooltip>

                                        {collapsed && <Divider style={{margin: 0}} />}

                                        <Menu.ItemGroup
                                            title={!collapsed && "Automatic Evaluation"}
                                            className={classes.subMenuContainer}
                                        >
                                            <Tooltip
                                                placement="right"
                                                title={
                                                    !collapsed
                                                        ? "Select and customize evaluators such as custom code or regex evaluators."
                                                        : ""
                                                }
                                            >
                                                <Menu.Item
                                                    style={{paddingLeft: 16}}
                                                    icon={<SlidersOutlined />}
                                                >
                                                    <Link
                                                        data-cy="app-evaluators-link"
                                                        href={getNavigationPath(
                                                            "evaluations/new-evaluator",
                                                        )}
                                                        className={classes.menuLinks}
                                                    >
                                                        {collapsed
                                                            ? "Select and customize evaluators such as custom code or regex evaluators."
                                                            : "Evaluators"}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                            <Tooltip
                                                placement="right"
                                                title={
                                                    !collapsed
                                                        ? "Choose your variants and evaluators to start the evaluation process."
                                                        : ""
                                                }
                                            >
                                                <Menu.Item
                                                    style={{paddingLeft: 16}}
                                                    icon={<PlayCircleOutlined />}
                                                >
                                                    <Link
                                                        data-cy="app-evaluations-results-link"
                                                        href={getNavigationPath(
                                                            "evaluations/results",
                                                        )}
                                                        className={classes.menuLinks}
                                                    >
                                                        {collapsed
                                                            ? "Choose your variants and evaluators to start the evaluation process."
                                                            : "Results"}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                        </Menu.ItemGroup>
                                        {collapsed && <Divider style={{margin: 0}} />}

                                        <Menu.ItemGroup
                                            title={!collapsed && "Human Evaluation"}
                                            className={classes.subMenuContainer}
                                        >
                                            <Tooltip
                                                placement="right"
                                                title={
                                                    !collapsed
                                                        ? "A/B tests allow you to compare the performance of two different variants manually."
                                                        : ""
                                                }
                                            >
                                                <Menu.Item
                                                    style={{paddingLeft: 16}}
                                                    icon={
                                                        <Image
                                                            src={abTesting}
                                                            alt="A/B testing"
                                                            className={classes.evaluationImg}
                                                        />
                                                    }
                                                >
                                                    <Link
                                                        data-cy="app-human-ab-testing-link"
                                                        href={getNavigationPath(
                                                            "annotations/human_a_b_testing",
                                                        )}
                                                        className={classes.menuLinks}
                                                    >
                                                        {collapsed
                                                            ? "A/B tests allow you to compare the performance of two different variants manually."
                                                            : "A/B Test"}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                            <Tooltip
                                                placement="right"
                                                title={
                                                    !collapsed
                                                        ? "Single model test allows you to score the performance of a single LLM app manually."
                                                        : ""
                                                }
                                            >
                                                <Menu.Item
                                                    style={{paddingLeft: 16}}
                                                    icon={
                                                        <Image
                                                            src={singleModel}
                                                            alt="A/B testing"
                                                            className={classes.evaluationImg}
                                                        />
                                                    }
                                                >
                                                    <Link
                                                        data-cy="app-single-model-test-link"
                                                        href={getNavigationPath(
                                                            "annotations/single_model_test",
                                                        )}
                                                        className={classes.menuLinks}
                                                    >
                                                        {collapsed
                                                            ? "Single model test allows you to score the performance of a single LLM app manually."
                                                            : "Single Model Test"}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                        </Menu.ItemGroup>

                                        {collapsed && <Divider style={{margin: 0}} />}

                                        <Menu.ItemGroup
                                            title={!collapsed && "Deployment"}
                                            className={classes.subMenuContainer}
                                        >
                                            <Tooltip
                                                placement="right"
                                                title={
                                                    !collapsed
                                                        ? "Deploy your applications to different environments."
                                                        : ""
                                                }
                                                key="endpoints"
                                            >
                                                <Menu.Item
                                                    style={{paddingLeft: 16}}
                                                    icon={<CloudUploadOutlined />}
                                                >
                                                    <Link
                                                        data-cy="app-endpoints-link"
                                                        href={getNavigationPath("endpoints")}
                                                        className={classes.menuLinks}
                                                    >
                                                        <Space>
                                                            <span>
                                                                {collapsed
                                                                    ? "Deploy your applications to different environments."
                                                                    : "Endpoints"}
                                                            </span>
                                                        </Space>
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                        </Menu.ItemGroup>
                                    </>
                                )}
                            </Menu>

                            <Menu
                                mode="vertical"
                                className={classes.menuContainer2}
                                selectedKeys={selectedKeys}
                            >
                                {doesSessionExist && (
                                    <Menu.Item key="settings" icon={<SettingOutlined />}>
                                        <Link data-cy="settings-link" href="/settings">
                                            Settings
                                        </Link>
                                    </Menu.Item>
                                )}

                                <Menu.Item key="docs" icon={<ReadOutlined />}>
                                    <Link href="https://docs.agenta.ai" target="_blank">
                                        Docs
                                    </Link>
                                </Menu.Item>

                                {isDemo() && (
                                    <>
                                        <Menu.Item key="expert" icon={<PhoneOutlined />}>
                                            <Link
                                                href="https://cal.com/mahmoud-mabrouk-ogzgey/demo"
                                                target="_blank"
                                            >
                                                Book Onboarding Call
                                            </Link>
                                        </Menu.Item>
                                        <OrgsListSubMenu key="workspaces" />
                                        {user?.username && (
                                            <Menu.Item
                                                key="logout"
                                                icon={<LogoutOutlined />}
                                                onClick={handleLogout}
                                            >
                                                Logout
                                            </Menu.Item>
                                        )}
                                    </>
                                )}
                            </Menu>
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default Sidebar
