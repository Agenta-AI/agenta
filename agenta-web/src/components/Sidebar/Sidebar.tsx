import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    LineChartOutlined,
    QuestionOutlined,
    PhoneOutlined,
    SettingOutlined,
    LogoutOutlined,
    UserOutlined,
} from "@ant-design/icons"
import {Layout, Menu, Space, Tooltip, theme, Dropdown, Select, Avatar} from "antd"

import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import AlertPopup from "../AlertPopup/AlertPopup"
import {useProfileData} from "@/contexts/profile.context"
import {getColorFromStr, getGradientFromStr} from "@/lib/helpers/colors"
import {getInitials, isDemo} from "@/lib/helpers/utils"
import {useSession} from "@/hooks/useSession"

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
    menuItemNoBg: {
        textOverflow: "unset !important",
        "& .ant-select-selector": {
            padding: "0 !important",
        },
        "&> span": {
            display: "inline-block",
            marginTop: 4,
        },
        "& .ant-select-selection-item": {
            "&> span > span": {
                width: 120,
                marginRight: 10,
            },
        },
    },
    orgLabel: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        justifyContent: "flex-start",
        "&> div": {
            width: 18,
            height: 18,
            aspectRatio: "1/1",
            borderRadius: "50%",
        },
        "&> span": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
})

const Sidebar: React.FC = () => {
    const {appTheme, toggleAppTheme} = useAppTheme()
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
    const {user, orgs, selectedOrg, changeSelectedOrg, reset} = useProfileData()
    const [collapsed, setCollapsed] = useState(false)

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

                                        <Tooltip
                                            placement="right"
                                            title={
                                                !collapsed
                                                    ? "Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                                    : ""
                                            }
                                            key="evaluations"
                                        >
                                            <Menu.Item icon={<LineChartOutlined />}>
                                                <Link
                                                    data-cy="app-evaluations-link"
                                                    href={getNavigationPath("evaluations")}
                                                    className={classes.menuLinks}
                                                >
                                                    {collapsed
                                                        ? "Perform 1-to-1 variant comparisons on testsets to identify superior options."
                                                        : "Evaluate"}
                                                </Link>
                                            </Menu.Item>
                                        </Tooltip>

                                        <Tooltip
                                            placement="right"
                                            title={
                                                !collapsed
                                                    ? "Monitor production logs to ensure seamless operations."
                                                    : ""
                                            }
                                            key="endpoints"
                                        >
                                            <Menu.Item icon={<CloudUploadOutlined />}>
                                                <Link
                                                    data-cy="app-endpoints-link"
                                                    href={getNavigationPath("endpoints")}
                                                    className={classes.menuLinks}
                                                >
                                                    <Space>
                                                        <span>
                                                            {collapsed
                                                                ? "Monitor production logs to ensure seamless operations."
                                                                : "Endpoints"}
                                                        </span>
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
                                {doesSessionExist && (
                                    <Menu.Item key="settings" icon={<SettingOutlined />}>
                                        <Link data-cy="settings-link" href="/settings">
                                            Settings
                                        </Link>
                                    </Menu.Item>
                                )}

                                <Menu.Item key="help" icon={<QuestionOutlined />}>
                                    <Link href="https://docs.agenta.ai" target="_blank">
                                        Help
                                    </Link>
                                </Menu.Item>

                                {isDemo() && (
                                    <>
                                        <Menu.Item key="expert" icon={<PhoneOutlined />}>
                                            <Link
                                                href="https://cal.com/mahmoud-mabrouk-ogzgey/demo"
                                                target="_blank"
                                            >
                                                Talk to an Expert
                                            </Link>
                                        </Menu.Item>
                                        {selectedOrg && (
                                            <Menu.Item
                                                key="org"
                                                className={classes.menuItemNoBg}
                                                title=""
                                            >
                                                <Select
                                                    bordered={false}
                                                    value={selectedOrg.id}
                                                    options={orgs.map((org) => ({
                                                        label: (
                                                            <Tooltip
                                                                title={!collapsed ? org.name : ""}
                                                            >
                                                                <span className={classes.orgLabel}>
                                                                    <div
                                                                        style={{
                                                                            backgroundImage:
                                                                                getGradientFromStr(
                                                                                    org.id,
                                                                                ),
                                                                        }}
                                                                    />
                                                                    <span>{org.name}</span>
                                                                </span>
                                                            </Tooltip>
                                                        ),
                                                        value: org.id,
                                                    }))}
                                                    onChange={(value) => changeSelectedOrg(value)}
                                                />
                                            </Menu.Item>
                                        )}
                                        {user?.username && (
                                            <Menu.Item
                                                key="user"
                                                title={collapsed && user?.username}
                                            >
                                                <Dropdown
                                                    menu={{
                                                        items: [
                                                            {
                                                                key: "email",
                                                                label: user.email,
                                                                icon: <UserOutlined />,
                                                                title: "",
                                                            },
                                                            {
                                                                key: "logout",
                                                                label: "Logout",
                                                                onClick: handleLogout,
                                                                icon: <LogoutOutlined />,
                                                                title: "",
                                                            },
                                                        ],
                                                    }}
                                                    trigger={["click"]}
                                                >
                                                    <a onClick={(e) => e.preventDefault()}>
                                                        <Space>
                                                            <Avatar
                                                                style={{
                                                                    backgroundColor:
                                                                        getColorFromStr(user.email),
                                                                }}
                                                                size="small"
                                                            >
                                                                {getInitials(user.email)}
                                                            </Avatar>
                                                            <span>
                                                                {collapsed || user.username}
                                                            </span>
                                                        </Space>
                                                    </a>
                                                </Dropdown>
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
