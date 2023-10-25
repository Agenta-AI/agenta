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
                                key="apps"
                                placement="right"
                                title="Create new applications or switch between your existing projects."
                            >
                                <Menu.Item
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
                                        key="testsets"
                                    >
                                        <Menu.Item
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
                                        key="evaluations"
                                    >
                                        <Menu.Item
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
                                        key="endpoints"
                                    >
                                        <Menu.Item
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
                                        <Menu.Item key="org" className={classes.menuItemNoBg}>
                                            <Select
                                                bordered={false}
                                                value={selectedOrg.id}
                                                options={orgs.map((org) => ({
                                                    label: (
                                                        <Tooltip title={org.name}>
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
                                        <Menu.Item key="user">
                                            <Dropdown
                                                menu={{
                                                    items: [
                                                        {key: "email", label: user.email},
                                                        {
                                                            key: "logout",
                                                            label: "Logout",
                                                            onClick: handleLogout,
                                                        },
                                                    ],
                                                }}
                                                trigger={["click"]}
                                            >
                                                <a onClick={(e) => e.preventDefault()}>
                                                    <Space>
                                                        <Avatar
                                                            style={{
                                                                backgroundColor: getColorFromStr(
                                                                    user.email,
                                                                ),
                                                            }}
                                                            size="small"
                                                        >
                                                            {getInitials(user.email)}
                                                        </Avatar>
                                                        <span>{user.username}</span>
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
    )
}

export default Sidebar
