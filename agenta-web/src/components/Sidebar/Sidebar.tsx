import {memo, useEffect, useMemo, useState, useCallback} from "react"

import {useRouter} from "next/router"
import {Button, Divider, Dropdown, Layout, Menu, Space, Tag, Tooltip, Typography} from "antd"
import Link from "next/link"
import clsx from "clsx"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

import Logo from "../Logo/Logo"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ErrorBoundary} from "react-error-boundary"
import {SidebarConfig, useSidebarConfig} from "./config"
import {isDemo} from "@/lib/helpers/utils"
import {useProfileData} from "@/contexts/profile.context"
import {useSession} from "@/hooks/useSession"
import {CaretDown, Gear, SidebarSimple, SignOut} from "@phosphor-icons/react"
import AlertPopup from "../AlertPopup/AlertPopup"
import Avatar from "@/components/Avatar/Avatar"
import {useProjectData} from "@/contexts/project.context"
import {useOrgData} from "@/contexts/org.context"
import {ItemType} from "antd/es/menu/interface"
import {JSSTheme} from "@/lib/Types"

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
        padding: "10px",
        "& > div:nth-of-type(1)": {
            display: "flex",
            justifyContent: "center",
        },
        "& > div:nth-of-type(3)": {
            display: "flex",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 1,
            overflowY: "auto",
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

    const transformItems = useCallback(
        (items: SidebarConfig[]): any => {
            return items.flatMap((item): any => {
                if (item.submenu) {
                    return {
                        key: item.key,
                        icon: item.icon,
                        label: (
                            <>
                                {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                            </>
                        ),
                        children: transformItems(item.submenu),
                        disabled: item.isCloudFeature,
                        onTitleClick: item.onClick,
                        title: (
                            <Tooltip title={item.cloudFeatureTooltip} placement="right">
                                {item.title}
                            </Tooltip>
                        ),
                    }
                } else if (item.header) {
                    return {
                        type: "group",
                        label: (
                            <div key={item.key} className={classes.menuHeader}>
                                {item.title}
                            </div>
                        ),
                    }
                } else {
                    const node = (
                        <Link
                            data-cy={item.key}
                            className={classes.menuLinks}
                            href={item.link || "#"}
                            onClick={item.onClick}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                        >
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </Link>
                    )

                    return [
                        {
                            icon: item.icon,
                            key: item.key,
                            label: (
                                <>
                                    {collapsed ? (
                                        node
                                    ) : (
                                        <Tooltip title={item.tooltip} placement="right">
                                            {node}
                                        </Tooltip>
                                    )}
                                </>
                            ),
                        },
                        item.divider && {type: "divider", className: "!my-4"},
                    ]
                }
            })
        },
        [items, collapsed],
    )

    return <Menu mode={mode} items={transformItems(items)} {...menuProps} />
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
    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()
    const [isHovered, setIsHovered] = useState(false)

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

    const dropdownItems = useMemo(() => {
        if (selectedOrg?.id && user?.id && isDemo()) {
            return [
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
                        <Link href={"/settings"} className="flex items-center gap-2">
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
            ]
        } else {
            return []
        }
    }, [logout, orgs, project?.is_demo, selectedOrg?.id, user?.id])

    return (
        <div className={classes.siderWrapper}>
            <Sider
                theme={appTheme}
                className={classes.sidebar}
                collapsible
                collapsed={collapsed && !isHovered}
                width={236}
                trigger={null}
                onMouseOver={() => {
                    if (collapsed) setIsHovered(true)
                }}
                onMouseOut={() => {
                    if (collapsed) setIsHovered(false)
                }}
            >
                <div className={classes.sliderContainer}>
                    <div
                        className={` overflow-hidden h-[51px] transition-width duration-[inherit] ease-in-out relative flex flex-col ${
                            collapsed && !isHovered ? "w-[40px]" : "w-full"
                        }`}
                    >
                        <div
                            className={clsx([
                                "flex items-center gap-2",
                                "transition-width duration-[inherit] ease-in-out",
                                "w-full",
                            ])}
                        >
                            <div className="transition-width duration-[inherit] ease-in-out w-full">
                                {!isDemo() && (
                                    <Link data-cy="app-management-link" href="/apps">
                                        <Logo isOnlyIconLogo={collapsed && !isHovered} />
                                    </Link>
                                )}
                                {selectedOrg?.id && user?.id && isDemo() && (
                                    <Dropdown
                                        trigger={["hover"]}
                                        menu={{
                                            // @ts-ignore
                                            items: dropdownItems,
                                            selectedKeys: [selectedOrg.id],
                                            onClick: ({key}) => {
                                                if (["settings", "logout"].includes(key)) return
                                                changeSelectedOrg(key)
                                            },
                                        }}
                                    >
                                        <Button
                                            className={`${classes.avatarMainContainer} ${collapsed && !isHovered ? "border-none" : ""}`}
                                        >
                                            <div className={classes.avatarContainer}>
                                                <Avatar
                                                    className="text-lg"
                                                    name={selectedOrg.name}
                                                />

                                                <div>
                                                    <Text>{selectedOrg.name}</Text>
                                                    <Text>{selectedOrg.type}</Text>
                                                </div>
                                            </div>

                                            <CaretDown size={14} />
                                        </Button>
                                    </Dropdown>
                                )}
                            </div>

                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setCollapsed(!collapsed)
                                }}
                                icon={<SidebarSimple size={14} />}
                                type={collapsed && isHovered ? "primary" : undefined}
                            />
                        </div>
                    </div>

                    <Divider className="my-4" />
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
                                collapsed={collapsed && !isHovered}
                            />
                            <SidebarMenu
                                menuProps={{
                                    className: classes.menuContainer2,
                                    selectedKeys,
                                    openKeys: openKey ? [openKey] : [],
                                    onOpenChange: (openKeys) => setOpenKey(openKeys.at(-1)),
                                }}
                                items={bottomItems}
                                collapsed={collapsed && !isHovered}
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
