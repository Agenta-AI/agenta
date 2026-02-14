import {memo, useMemo, useState} from "react"

import {FolderIcon} from "@phosphor-icons/react"
import {CaretDown} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, theme} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import useSWR from "swr"

import {queryFolders} from "@/oss/services/folders"
import {useAppsData} from "@/oss/state/app"
import {routerAppNavigationAtom} from "@/oss/state/app/atoms/fetcher"
import {useProjectData} from "@/oss/state/project"

import {buildFolderTree, FolderTreeItem} from "../../pages/prompts/assets/utils"

interface ListOfAppsProps {
    collapsed: boolean
}

const ListOfApps = ({collapsed}: ListOfAppsProps) => {
    const {currentApp, apps, recentlyVisitedAppId} = useAppsData()
    const {projectId} = useProjectData()
    const navigateToApp = useSetAtom(routerAppNavigationAtom)
    const {token} = theme.useToken()

    const [dropdownOpen, setDropdownOpen] = useState(false)

    const {data: foldersData} = useSWR(projectId ? ["folders", projectId] : null, () =>
        queryFolders({folder: {}}, projectId),
    )

    const {appMenuItems, appKeyMap} = useMemo(() => {
        const folders = foldersData?.folders ?? []
        const {roots} = buildFolderTree(folders, apps)
        const keyMap: Record<string, string> = {}
        const items: MenuProps["items"] = []

        const flatten = (nodes: FolderTreeItem[], depth: number) => {
            nodes.forEach((node) => {
                if (node.type === "folder") {
                    items.push({
                        key: `folder:${node.id}`,
                        disabled: true,
                        label: (
                            <div
                                className="flex items-center gap-1.5 w-full max-w-[400px]"
                                style={{paddingLeft: depth > 0 ? depth * 12 : 0}}
                            >
                                <FolderIcon
                                    size={13}
                                    weight="fill"
                                    style={{color: token.colorTextTertiary, flexShrink: 0}}
                                />
                                <span
                                    className="truncate text-xs"
                                    style={{color: token.colorTextTertiary}}
                                    title={node.name}
                                >
                                    {node.name}
                                </span>
                            </div>
                        ),
                        style: {
                            cursor: "default",
                            minHeight: 28,
                            lineHeight: "28px",
                            margin: 0,
                            padding: "0 12px",
                            opacity: 1,
                        },
                    })
                    flatten(node.children ?? [], depth + 1)
                } else {
                    const key = `app:${node.app_id}`
                    keyMap[key] = node.app_id
                    items.push({
                        key,
                        label: (
                            <div
                                className="w-full max-w-[400px]"
                                style={{paddingLeft: depth > 0 ? depth * 12 : 0}}
                            >
                                <span className="truncate block" title={node.app_name}>
                                    {node.app_name}
                                </span>
                            </div>
                        ),
                    })
                }
            })
        }

        flatten(roots, 0)

        return {
            appMenuItems: items,
            appKeyMap: keyMap,
        }
    }, [apps, foldersData, token])

    const selectedAppId = currentApp?.app_id || recentlyVisitedAppId
    const selectedKey = selectedAppId ? [`app:${selectedAppId}`] : undefined

    const handleMenuClick: MenuProps["onClick"] = ({key}) => {
        const appId = appKeyMap[key]
        if (appId) {
            setDropdownOpen(false)
            navigateToApp(appId)
        }
    }

    const appLabel =
        (selectedAppId && apps?.find((app) => app.app_id === selectedAppId)?.app_name) ||
        "Select app"

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            destroyOnHidden
            styles={{
                root: {
                    zIndex: 2000,
                    minWidth: 220,
                },
            }}
            open={dropdownOpen}
            onOpenChange={setDropdownOpen}
            className={clsx({"flex items-center justify-center": collapsed})}
            menu={{
                items: appMenuItems,
                selectedKeys: selectedKey,
                onClick: handleMenuClick,
                className: "max-h-80 overflow-y-auto",
            }}
        >
            <Button
                type="text"
                className={clsx("flex items-center justify-between gap-2 w-full px-1.5 py-3", {
                    "!w-auto": collapsed,
                })}
            >
                <span
                    className={clsx("truncate", collapsed ? "max-w-[52px]" : "max-w-[180px]")}
                    title={appLabel}
                >
                    {appLabel}
                </span>
                {!collapsed && (
                    <CaretDown
                        size={14}
                        className={clsx("transition-transform", dropdownOpen ? "rotate-180" : "")}
                    />
                )}
            </Button>
        </Dropdown>
    )
}

export default memo(ListOfApps)
