import React, {useMemo} from "react"
import {useRouter} from "next/router"
import {Layout, Menu, Tooltip} from "antd"
import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"
import {SidebarConfig, useSidebarConfig} from "./config"
import {JSSTheme} from "@/lib/Types"

const {Sider} = Layout

const useStyles = createUseStyles((theme: JSSTheme) => ({
    sidebar: {
        background: `${theme.colorBgContainer} !important`,
        height: "100vh",
        position: "sticky !important",
        bottom: "0px",
        top: "0px",

        "&>div:nth-of-type(2)": {
            background: `${theme.colorBgContainer} !important`,
        },
    },
    siderWrapper: {
        border: `0.01px solid ${theme.isDark ? "#222" : "#ddd"}`,
    },
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
}))

const SidebarMenu: React.FC<{
    items: SidebarConfig[]
    selectedKeys: string[]
    menuProps?: React.ComponentProps<typeof Menu>
}> = ({items, selectedKeys, menuProps}) => {
    return (
        <Menu mode="vertical" selectedKeys={selectedKeys} {...menuProps}>
            {items.map((item) => {
                if (item.submenu) {
                    return (
                        <Menu.SubMenu
                            key={item.key}
                            icon={item.icon}
                            title={item.title}
                            onTitleClick={item.onClick}
                        >
                            {item.submenu.map((subitem) => (
                                <Menu.Item
                                    icon={subitem.icon}
                                    key={subitem.key}
                                    onClick={subitem.onClick}
                                >
                                    <Tooltip title={subitem.tooltip}>
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
                                    </Tooltip>
                                </Menu.Item>
                            ))}
                        </Menu.SubMenu>
                    )
                } else {
                    return (
                        <Menu.Item icon={item.icon} key={item.key} onClick={item.onClick}>
                            <Tooltip title={item.tooltip}>
                                <Link
                                    href={item.link || "#"}
                                    target={item.link?.startsWith("http") ? "_blank" : undefined}
                                >
                                    {item.title}
                                </Link>
                            </Tooltip>
                        </Menu.Item>
                    )
                }
            })}
        </Menu>
    )
}

const Sidebar: React.FC = () => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const classes = useStyles()

    const [collapsed, setCollapsed] = useLocalStorage("sidebarCollapsed", false)

    const menu = useSidebarConfig()
    const {topItems, bottomItems} = useMemo(() => {
        const topItems: SidebarConfig[] = []
        const bottomItems: SidebarConfig[] = []

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

    const selectedKeys = useMemo(() => {
        let matched: SidebarConfig

        const executor = (items: SidebarConfig[]) => {
            items.forEach((item) => {
                if (item.submenu?.length) {
                    executor(item.submenu)
                } else if (
                    item.link &&
                    router.asPath.startsWith(item.link) &&
                    item.link.length > (matched?.link?.length || 0)
                ) {
                    matched = item
                }
            })
        }
        executor([...topItems, ...bottomItems])

        //@ts-ignore
        return [matched?.key]
    }, [router.asPath, topItems, bottomItems])

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
                            <SidebarMenu
                                menuProps={{className: classes.menuContainer}}
                                items={topItems}
                                selectedKeys={selectedKeys}
                            />
                            <SidebarMenu
                                menuProps={{className: classes.menuContainer2}}
                                items={bottomItems}
                                selectedKeys={selectedKeys}
                            />
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default Sidebar
