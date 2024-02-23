import React, {useEffect, useMemo, useState} from "react"
import {useRouter} from "next/router"
import {Layout, Menu, Tooltip, theme} from "antd"
import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"
import {useSidebarConfig} from "./config"

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
        maxHeight: 312,
        overflowY: "auto",
        position: "relative",
    },
    menuContainer2: {
        borderRight: "0 !important",
    },
    menuLinks: {
        width: "100%",
    },
})

const Sidebar: React.FC = () => {
    const {appTheme} = useAppTheme()
    const {
        token: {colorBgContainer},
    } = theme.useToken()
    const router = useRouter()
    const classes = useStyles({
        themeMode: appTheme,
        colorBgContainer,
    } as StyleProps)

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
    const [collapsed, setCollapsed] = useLocalStorage("sidebarCollapsed", false)

    useEffect(() => {
        setSelectedKeys(initialSelectedKeys)
    }, [page_name])

    const menu = useSidebarConfig()
    const {topItems, bottomItems} = useMemo(() => {
        const topItems: ReturnType<typeof useSidebarConfig> = []
        const bottomItems: ReturnType<typeof useSidebarConfig> = []

        menu.forEach((item) => {
            if (item.isHidden) return
            if (item.isBottom) {
                bottomItems.push(item)
            } else {
                topItems.push(item)
            }
        })

        return {
            topItems,
            bottomItems,
        }
    }, [menu])

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
                        <Link data-cy="app-management-link" href="/apps">
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
                                {topItems.map((item) => {
                                    if (item.submenu) {
                                        return (
                                            <Menu.SubMenu
                                                key={item.key}
                                                icon={item.icon}
                                                title={item.title}
                                            >
                                                {item.submenu.map((subitem) => (
                                                    <Tooltip
                                                        title={subitem.tooltip}
                                                        key={subitem.key}
                                                    >
                                                        <Menu.Item icon={subitem.icon}>
                                                            <Link
                                                                href={subitem.link || "#"}
                                                                target={
                                                                    subitem.link?.startsWith("http")
                                                                        ? "_blank"
                                                                        : undefined
                                                                }
                                                            >
                                                                {subitem.title}
                                                            </Link>
                                                        </Menu.Item>
                                                    </Tooltip>
                                                ))}
                                            </Menu.SubMenu>
                                        )
                                    } else {
                                        return (
                                            <Tooltip title={item.tooltip} key={item.key}>
                                                <Menu.Item icon={item.icon}>
                                                    <Link
                                                        href={item.link || "#"}
                                                        target={
                                                            item.link?.startsWith("http")
                                                                ? "_blank"
                                                                : undefined
                                                        }
                                                    >
                                                        {item.title}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                        )
                                    }
                                })}
                            </Menu>

                            <Menu
                                mode="vertical"
                                className={classes.menuContainer2}
                                selectedKeys={selectedKeys}
                            >
                                {bottomItems.map((item) => {
                                    if (item.submenu) {
                                        return (
                                            <Menu.SubMenu
                                                key={item.key}
                                                icon={item.icon}
                                                title={item.title}
                                            >
                                                {item.submenu.map((subitem) => (
                                                    <Tooltip
                                                        title={subitem.tooltip}
                                                        key={subitem.key}
                                                    >
                                                        <Menu.Item icon={subitem.icon}>
                                                            <Link
                                                                href={subitem.link || "#"}
                                                                target={
                                                                    subitem.link?.startsWith("http")
                                                                        ? "_blank"
                                                                        : undefined
                                                                }
                                                            >
                                                                {subitem.title}
                                                            </Link>
                                                        </Menu.Item>
                                                    </Tooltip>
                                                ))}
                                            </Menu.SubMenu>
                                        )
                                    } else {
                                        return (
                                            <Tooltip title={item.tooltip} key={item.key}>
                                                <Menu.Item icon={item.icon}>
                                                    <Link
                                                        href={item.link || "#"}
                                                        target={
                                                            item.link?.startsWith("http")
                                                                ? "_blank"
                                                                : undefined
                                                        }
                                                    >
                                                        {item.title}
                                                    </Link>
                                                </Menu.Item>
                                            </Tooltip>
                                        )
                                    }
                                })}
                            </Menu>
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default Sidebar
