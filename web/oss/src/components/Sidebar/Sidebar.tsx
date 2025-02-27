import {memo, useEffect, useMemo, useState} from "react"

import {CaretDown, SidebarSimple} from "@phosphor-icons/react"
import {Button, Divider, Dropdown, Layout, Typography} from "antd"
import clsx from "clsx"
import Link from "next/link"
import {useRouter} from "next/router"
import {ErrorBoundary} from "react-error-boundary"
import {useLocalStorage} from "usehooks-ts"

import Avatar from "@/oss/components/Avatar/Avatar"
import {useOrgData} from "@/oss/contexts/org.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useProjectData} from "@/oss/contexts/project.context"
import {useSession} from "@/oss/hooks/useSession"
import {isDemo} from "@/oss/lib/helpers/utils"

import {useAppTheme} from "../Layout/ThemeContextProvider"
import Logo from "../Logo/Logo"

import {useStyles} from "./assets/styles"
import SidebarMenu from "./components/SidebarMenu"
import {useDropdownItems} from "./hooks/useDropdownItems"
import {useSidebarConfig} from "./hooks/useSidebarConfig"
import {SidebarConfig} from "./types"

const {Sider} = Layout
const {Text} = Typography

const Sidebar: React.FC = () => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const classes = useStyles()
    const [openKey, setOpenKey] = useState<string>()
    const [collapsed, setCollapsed] = useLocalStorage("sidebarCollapsed", false)
    const menu = useSidebarConfig()
    const {user} = useProfileData()
    const {logout} = useSession()
    const {project, projects} = useProjectData()
    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()
    const [isHovered, setIsHovered] = useState(false)
    const dropdownItems = useDropdownItems({logout, orgs, selectedOrg, user, project, projects})

    const isSidebarExpanded = useMemo(() => collapsed && !isHovered, [collapsed, isHovered])

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
        setOpenKey((prevKey) => {
            if (prevKey !== openKeys[0]) {
                return openKeys[0]
            }

            return prevKey
        })
    }, [openKeys[0]])

    return (
        <div className={classes.siderWrapper}>
            <Sider
                theme={appTheme}
                className={classes.sidebar}
                collapsible
                width={collapsed ? 80 : 236}
                trigger={null}
                onMouseOver={() => {
                    if (collapsed) setIsHovered(true)
                }}
                onMouseOut={() => {
                    if (collapsed) setIsHovered(false)
                }}
            >
                <div
                    className={clsx([
                        classes.sliderContainer,
                        "absolute left-0 top-0 h-full bg-white transition-all duration-300",
                        collapsed ? (isHovered ? "w-[236px]" : "w-[80px]") : "w-[236px]",
                    ])}
                >
                    <div
                        className={` overflow-hidden h-[51px] transition-width duration-[inherit] ease-in-out relative flex flex-col ${
                            isSidebarExpanded ? "w-[49px] relative left-[7px]" : "w-full"
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
                                        <Logo isOnlyIconLogo={isSidebarExpanded} />
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
                                            className={`${classes.avatarMainContainer} ${isSidebarExpanded ? "border-none" : ""}`}
                                        >
                                            <div className={classes.avatarContainer}>
                                                <Avatar
                                                    className="text-lg"
                                                    name={selectedOrg.name}
                                                />

                                                <div className="max-w-[95px] text-ellipsis overflow-hidden">
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
                                icon={<SidebarSimple size={14} className="mt-0.5" />}
                                className="shrink-0 flex items-center justify-center"
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
                                collapsed={isSidebarExpanded}
                            />
                            <SidebarMenu
                                menuProps={{
                                    className: classes.menuContainer2,
                                    selectedKeys,
                                    openKeys: openKey ? [openKey] : [],
                                    onOpenChange: (openKeys) => setOpenKey(openKeys.at(-1)),
                                }}
                                items={bottomItems}
                                collapsed={isSidebarExpanded}
                                mode={isSidebarExpanded ? "inline" : "vertical"}
                            />
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default memo(Sidebar)
