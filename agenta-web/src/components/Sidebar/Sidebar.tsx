import React, {useEffect, useMemo, useState} from "react"
import {useRouter} from "next/router"
import {Avatar, Button, Divider, Dropdown, Layout, Menu, Space, Tag, Tooltip} from "antd"
import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"
import {SidebarConfig, useSidebarConfig} from "./config"
import {JSSTheme} from "@/lib/Types"
import {getColorFromStr} from "@/lib/helpers/colors"
import {getInitials, isDemo} from "@/lib/helpers/utils"
import {useProfileData} from "@/contexts/profile.context"
import {useSession} from "@/hooks/useSession"
import {CaretDown, Gear, SignOut} from "@phosphor-icons/react"
import AlertPopup from "../AlertPopup/AlertPopup"
import {dynamicContext} from "@/lib/helpers/dynamic"

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
            margin: `${theme.padding}px 0`,
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
            display: "flex",
            alignItems: "center",
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
        width: "100%",
    },
}))

const SidebarMenu: React.FC<{
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: React.ComponentProps<typeof Menu>
    mode?: "horizontal" | "vertical" | "inline"
}> = ({items, menuProps, collapsed, mode = "inline"}) => {
    const classes = useStyles()

    return (
        <Menu mode={mode} {...menuProps}>
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
                        <>
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
                            {item.divider && <Divider className="my-4" />}
                        </>
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
    const {user} = useProfileData()
    const {logout} = useSession()
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

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
                        {!isDemo() && (
                            <Link data-cy="app-management-link" href="/apps">
                                <Logo isOnlyIconLogo={collapsed} />
                            </Link>
                        )}
                        {selectedOrg?.id && user?.id && isDemo() && (
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        ...orgs.map((org: any) => ({
                                            key: org.id,
                                            label: (
                                                <Space>
                                                    <Avatar
                                                        size={"small"}
                                                        style={{
                                                            backgroundColor: getColorFromStr(
                                                                org.id,
                                                            ),
                                                            color: "#fff",
                                                        }}
                                                    >
                                                        {getInitials(org.name)}
                                                    </Avatar>
                                                    <div>{org.name}</div>
                                                </Space>
                                            ),
                                        })),
                                        {type: "divider"},
                                        {
                                            key: "settings",
                                            label: (
                                                <Link
                                                    href={"/settings"}
                                                    className="flex items-center gap-2"
                                                >
                                                    <Gear size={16} />
                                                    <div>Settings</div>
                                                </Link>
                                            ),
                                        },
                                        {
                                            key: "logout",
                                            label: (
                                                <div
                                                    className="flex items-center gap-2"
                                                    onClick={() => {
                                                        AlertPopup({
                                                            title: "Logout",
                                                            message:
                                                                "Are you sure you want to logout?",
                                                            onOk: logout,
                                                        })
                                                    }}
                                                >
                                                    <SignOut size={16} />
                                                    <div>Logout</div>
                                                </div>
                                            ),
                                        },
                                    ],
                                    selectedKeys: [selectedOrg.id],
                                    onClick: ({key}) => {
                                        if (["settings", "logout"].includes(key)) return
                                        changeSelectedOrg(key)
                                    },
                                }}
                            >
                                <Button className="flex w-full h-full items-center justify-between">
                                    <div className="flex gap-2">
                                        <Avatar
                                            shape="square"
                                            style={{
                                                backgroundColor: getColorFromStr(selectedOrg.id),
                                                color: "#fff",
                                                fontSize: 18,
                                            }}
                                        >
                                            {getInitials(selectedOrg.name)}
                                        </Avatar>

                                        <div>{selectedOrg.name}</div>
                                    </div>

                                    <CaretDown size={14} />
                                </Button>
                            </Dropdown>
                        )}
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
                                mode="vertical"
                            />
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default Sidebar
