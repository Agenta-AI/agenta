import React, {useEffect, useMemo, useState} from "react"
import {useRouter} from "next/router"
import {Layout, Menu, Tag, Tooltip} from "antd"
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
        "& .ant-menu-submenu-title": {
            paddingInlineEnd: "20px",
            "& .ant-menu-submenu-arrow": {
                insetInlineEnd: "8px",
            },
        },
        "& .ant-menu-item,.ant-menu-submenu-title": {
            padding: "0 16px !important",
        },
        "& .ant-menu-sub > .ant-menu-item": {
            paddingLeft: "24px !important",
        },
    },
    menuContainer: {
        borderRight: "0 !important",
        maxHeight: "calc(100vh - 390px)",
        overflowY: "auto",
        position: "relative",
    },
    menuContainer2: {
        borderRight: "0 !important",
    },
    menuLinks: {
        display: "inline-block",
        width: "100%",
    },
}))

const SidebarMenu: React.FC<{
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: React.ComponentProps<typeof Menu>
}> = ({items, menuProps, collapsed}) => {
    const classes = useStyles()

    return (
        <Menu mode="inline" {...menuProps}>
            {items.map((item) => {
                if (item.submenu) {
                    if (item.isCloudFeature) {
                        return (
                            <Tooltip
                                title={item.cloudFeatureTooltip}
                                key={item.key}
                                placement="right"
                            >
                                <Menu.SubMenu
                                    icon={item.icon}
                                    title={
                                        <>
                                            {item.title}{" "}
                                            {item.tag && <Tag color="lime">{item.tag}</Tag>}
                                        </>
                                    }
                                    onTitleClick={item.onClick}
                                    disabled={item.isCloudFeature}
                                    data-cy={item.key}
                                >
                                    {item.submenu.map((subitem) => {
                                        const node = (
                                            <Link
                                                className={classes.menuLinks}
                                                href={subitem.link || "#"}
                                                target={
                                                    subitem.link?.startsWith("http")
                                                        ? "_blank"
                                                        : undefined
                                                }
                                            >
                                                {subitem.title}
                                            </Link>
                                        )

                                        return (
                                            <Menu.Item
                                                icon={subitem.icon}
                                                key={subitem.key}
                                                onClick={subitem.onClick}
                                                data-cy={subitem.key}
                                            >
                                                {collapsed ? (
                                                    node
                                                ) : (
                                                    <Tooltip
                                                        title={subitem.tooltip}
                                                        placement="right"
                                                    >
                                                        {node}
                                                    </Tooltip>
                                                )}
                                            </Menu.Item>
                                        )
                                    })}
                                </Menu.SubMenu>
                            </Tooltip>
                        )
                    } else {
                        return (
                            <Menu.SubMenu
                                key={item.key}
                                icon={item.icon}
                                title={
                                    <>
                                        {item.title}{" "}
                                        {item.tag && <Tag color="lime">{item.tag}</Tag>}
                                    </>
                                }
                                onTitleClick={item.onClick}
                                data-cy={item.key}
                            >
                                {item.submenu.map((subitem) => {
                                    const node = (
                                        <Link
                                            className={classes.menuLinks}
                                            href={subitem.link || "#"}
                                            target={
                                                subitem.link?.startsWith("http")
                                                    ? "_blank"
                                                    : undefined
                                            }
                                        >
                                            {subitem.title}
                                        </Link>
                                    )

                                    return (
                                        <Menu.Item
                                            icon={subitem.icon}
                                            key={subitem.key}
                                            onClick={subitem.onClick}
                                            data-cy={subitem.key}
                                        >
                                            {collapsed ? (
                                                node
                                            ) : (
                                                <Tooltip title={subitem.tooltip} placement="right">
                                                    {node}
                                                </Tooltip>
                                            )}
                                        </Menu.Item>
                                    )
                                })}
                            </Menu.SubMenu>
                        )
                    }
                } else {
                    const node = (
                        <Link
                            className={classes.menuLinks}
                            href={item.link || "#"}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                        >
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </Link>
                    )
                    return (
                        <Menu.Item
                            data-cy={item.key}
                            icon={item.icon}
                            key={item.key}
                            onClick={item.onClick}
                        >
                            {collapsed ? (
                                node
                            ) : (
                                <Tooltip title={item.tooltip} placement="right">
                                    {node}
                                </Tooltip>
                            )}
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
    const [openKey, setOpenKey] = useState<string>()

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

    const [selectedKeys, openKeys] = useMemo(() => {
        let matched: SidebarConfig
        let openKey = ""

        const executor = (items: SidebarConfig[], subKey?: string) => {
            items.forEach((item) => {
                if (item.submenu?.length) {
                    executor(item.submenu, item.key)
                } else if (
                    item.link &&
                    router.asPath.startsWith(item.link) &&
                    item.link.length > (matched?.link?.length || 0)
                ) {
                    matched = item
                    if (subKey) openKey = subKey
                }
            })
        }
        executor([...topItems, ...bottomItems])

        //@ts-ignore
        return [[matched?.key], openKey ? [openKey] : []]
    }, [router.asPath, topItems, bottomItems])

    useEffect(() => {
        setOpenKey(openKeys[0])
    }, [openKeys[0]])

    return (
        <div className={classes.siderWrapper}>
            <Sider
                theme={appTheme}
                className={classes.sidebar}
                width={236}
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
                                menuProps={{
                                    className: classes.menuContainer,
                                    selectedKeys,
                                    openKeys: openKey ? [openKey] : [],
                                    onOpenChange: (openKeys) => setOpenKey(openKeys.at(-1)),
                                }}
                                items={topItems}
                                collapsed={collapsed}
                            />
                            <SidebarMenu
                                menuProps={{
                                    className: classes.menuContainer2,
                                    selectedKeys,
                                    openKeys: openKey ? [openKey] : [],
                                    onOpenChange: (openKeys) => setOpenKey(openKeys.at(-1)),
                                }}
                                items={bottomItems}
                                collapsed={collapsed}
                            />
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default Sidebar
