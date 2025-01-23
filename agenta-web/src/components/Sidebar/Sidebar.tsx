import {memo, useEffect, useMemo, useState, type ComponentProps, type FC} from "react"
import {useRouter} from "next/router"
import {Button, Divider, Dropdown, Layout, Menu, Space, Tag, Tooltip, Typography} from "antd"
import Logo from "../Logo/Logo"
import Link from "next/link"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"
import {SidebarConfig, useSidebarConfig} from "./config"
import {JSSTheme} from "@/lib/Types"
import {isDemo} from "@/lib/helpers/utils"
import {useProfileData} from "@/contexts/profile.context"
import {useSession} from "@/hooks/useSession"
import {CaretDown, Gear, SignOut} from "@phosphor-icons/react"
import AlertPopup from "../AlertPopup/AlertPopup"
import {dynamicContext} from "@/lib/helpers/dynamic"
import Avatar from "@/components/Avatar/Avatar"
import {useProjectData} from "@/contexts/project.context"

const {Sider} = Layout
const {Text} = Typography

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
        padding: "0 10px 10px",
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
            overflowY: "auto",
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
    },
    menuContainer: {
        borderRight: "0 !important",
        overflowY: "auto",
        position: "relative",
        "& .ant-menu-item-selected": {
            fontWeight: theme.fontWeightMedium,
        },
    },
    menuContainer2: {
        borderRight: "0 !important",
    },
    menuLinks: {
        display: "inline-block",
        width: "100%",
    },
    menuItem: {
        textOverflow: "initial !important",
        display: "flex !important",
        alignItems: "center",
    },
    avatarMainContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 16px 4px 8px",
        borderRadius: theme.borderRadiusLG,
    },
    avatarContainer: {
        display: "flex",
        alignItems: "center",
        gap: theme.paddingSM,
        "& > div": {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            "& .ant-typography:nth-of-type(2)": {
                color: theme.colorTextDescription,
            },
        },
    },
    menuHeader: {
        padding: `${theme.paddingXS}px ${theme.padding}px`,
        color: theme.colorTextDescription,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
}))

const SidebarMenu: FC<{
    items: SidebarConfig[]
    collapsed: boolean
    menuProps?: ComponentProps<typeof Menu>
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
                                            className={classes.menuItem}
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
                } else if (item.header) {
                    return (
                        <div key={item.key} className={classes.menuHeader}>
                            {item.title}
                        </div>
                    )
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
                                className={classes.menuItem}
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

const Sidebar: FC = () => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const classes = useStyles()
    const [openKey, setOpenKey] = useState<string>()
    const [collapsed, setCollapsed] = useLocalStorage("sidebarCollapsed", false)
    const menu = useSidebarConfig()
    const {user} = useProfileData()
    const {logout} = useSession()
    const {project} = useProjectData()
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

    const _isDemo = useMemo(() => isDemo(), [])

    useEffect(() => {
        setOpenKey((prevKey) => {
            if (prevKey !== openKeys[0]) {
                return openKeys[0]
            }

            return prevKey
        })
    }, [openKeys[0]])

    return (
        <div className={classes.siderWrapper}>
            <Sider theme={appTheme} className={classes.sidebar} width={236}>
                <div className={classes.sliderContainer}>
                    <div>
                        {!_isDemo && (
                            <Link data-cy="app-management-link" href="/apps">
                                <Logo isOnlyIconLogo={collapsed} />
                            </Link>
                        )}
                        {selectedOrg?.id && user?.id && _isDemo && (
                            <Dropdown
                                trigger={["hover"]}
                                menu={{
                                    items: [
                                        ...orgs.map((org: any) => ({
                                            key: org.id,
                                            label: (
                                                <Space>
                                                    <Avatar size="small" name={org.name} />
                                                    <Text>{org.name}</Text>
                                                </Space>
                                            ),
                                        })),
                                        {type: "divider"},
                                        !project?.is_demo && {
                                            key: "settings",
                                            label: (
                                                <Link
                                                    href={"/settings"}
                                                    className="flex items-center gap-2"
                                                >
                                                    <Gear size={16} />
                                                    <Text>Settings</Text>
                                                </Link>
                                            ),
                                        },
                                        {
                                            key: "logout",
                                            label: (
                                                <div className="flex items-center gap-2">
                                                    <SignOut size={16} />
                                                    <Text>Logout</Text>
                                                </div>
                                            ),
                                            onClick: () => {
                                                AlertPopup({
                                                    title: "Logout",
                                                    message: "Are you sure you want to logout?",
                                                    onOk: logout,
                                                })
                                            },
                                        },
                                    ],
                                    selectedKeys: [selectedOrg.id],
                                    onClick: ({key}) => {
                                        if (["settings", "logout"].includes(key)) return
                                        changeSelectedOrg(key)
                                    },
                                }}
                            >
                                <Button className={classes.avatarMainContainer}>
                                    <div className={classes.avatarContainer}>
                                        <Avatar className="text-lg" name={selectedOrg.name} />

                                        {!collapsed && (
                                            <div>
                                                <Text>{selectedOrg.name}</Text>
                                                <Text>{selectedOrg.type}</Text>
                                            </div>
                                        )}
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

export default memo(Sidebar)
