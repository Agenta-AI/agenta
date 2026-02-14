import {memo, useEffect, useMemo, useState} from "react"

import {Divider, Layout} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import {useRouter} from "next/router"
import {ErrorBoundary} from "react-error-boundary"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

import {useAppTheme} from "../Layout/ThemeContextProvider"

import ListOfApps from "./components/ListOfApps"
import ListOfOrgs from "./components/ListOfOrgs"
import SidebarMenu from "./components/SidebarMenu"
import {useSidebarConfig} from "./hooks/useSidebarConfig"
import SettingsSidebar from "./SettingsSidebar"
import {SidebarConfig} from "./types"

const {Sider} = Layout

const Sidebar: React.FC<{showSettingsView?: boolean; lastPath?: string}> = ({
    showSettingsView,
    lastPath,
}) => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const [openKey, setOpenKey] = useState<string>()
    const [collapsed] = useAtom(sidebarCollapsedAtom)
    const menu = useSidebarConfig()

    const isSidebarCollapsed = collapsed

    const {projectItems, appItems, bottomItems} = useMemo(() => {
        const projectItems: SidebarConfig[] = []
        const appItems: SidebarConfig[] = []
        const bottomItems: SidebarConfig[] = []

        menu.forEach((item) => {
            if (item.isHidden) return
            if (item.isBottom) {
                bottomItems.push(item)
            } else if (item.isAppSection) {
                appItems.push(item)
            } else {
                projectItems.push(item)
            }
        })

        return {
            projectItems,
            appItems,
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
        executor([...projectItems, ...appItems, ...bottomItems])

        //@ts-ignore
        return [[matched?.key], openKey ? [openKey] : []]
    }, [router.asPath, projectItems, appItems, bottomItems])

    useEffect(() => {
        setOpenKey((prevKey) => {
            if (prevKey !== openKeys[0]) {
                return openKeys[0]
            }

            return prevKey
        })
    }, [openKeys[0]])

    return (
        <div className="border-0 border-r border-solid border-gray-100">
            <Sider
                theme={appTheme}
                className="sticky top-0 bottom-0 h-screen bg-white"
                collapsible
                width={collapsed ? 80 : 236}
                trigger={null}
            >
                <div
                    className={clsx(
                        "flex flex-col h-full transition-all duration-300",
                        collapsed ? "w-[80px]" : "w-[236px]",
                    )}
                >
                    {showSettingsView ? null : <ListOfOrgs collapsed={collapsed} />}

                    {showSettingsView ? null : <Divider className="-mt-[3.5px] mb-1" />}
                    <ErrorBoundary fallback={<div />}>
                        <div className="flex flex-col justify-between items-center h-full overflow-y-auto">
                            <div className="flex-1 min-h-0 w-full overflow-y-auto">
                                {showSettingsView ? (
                                    <SettingsSidebar lastPath={lastPath} />
                                ) : (
                                    <>
                                        <SidebarMenu
                                            menuProps={{
                                                className:
                                                    "border-r-0 overflow-y-auto relative [&_.ant-menu-item-selected]:font-medium",
                                                selectedKeys,
                                                openKeys: openKey ? [openKey] : [],
                                                onOpenChange: (openKeys) =>
                                                    setOpenKey((prev) => {
                                                        const next = openKeys.at(-1)
                                                        return prev === next ? prev : next
                                                    }),
                                            }}
                                            items={projectItems}
                                            collapsed={isSidebarCollapsed}
                                        />

                                        {appItems.length > 0 && (
                                            <>
                                                <Divider className="my-1" />
                                                <div className="px-2">
                                                    <ListOfApps collapsed={isSidebarCollapsed} />
                                                </div>
                                                <SidebarMenu
                                                    menuProps={{
                                                        className:
                                                            "border-r-0 overflow-y-auto relative [&_.ant-menu-item-selected]:font-medium",
                                                        selectedKeys,
                                                        openKeys: openKey ? [openKey] : [],
                                                        onOpenChange: (openKeys) =>
                                                            setOpenKey((prev) => {
                                                                const next = openKeys.at(-1)
                                                                return prev === next ? prev : next
                                                            }),
                                                    }}
                                                    items={appItems}
                                                    collapsed={isSidebarCollapsed}
                                                />
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="w-full flex flex-col shrink-0">
                                {!collapsed && (
                                    <div className="mx-auto">
                                        <SidePanelSubscriptionInfo />
                                    </div>
                                )}

                                <SidebarMenu
                                    menuProps={{
                                        className: "",
                                        selectedKeys,
                                        openKeys: openKey ? [openKey] : [],
                                        onOpenChange: (openKeys) =>
                                            setOpenKey((prev) => {
                                                const next = openKeys.at(-1)
                                                return prev === next ? prev : next
                                            }),
                                    }}
                                    items={bottomItems}
                                    collapsed={isSidebarCollapsed}
                                    mode={"vertical"}
                                />
                            </div>
                        </div>
                    </ErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default memo(Sidebar)
