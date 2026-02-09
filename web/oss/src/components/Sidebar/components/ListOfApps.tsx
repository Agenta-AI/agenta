import {memo, useMemo, useState} from "react"

import {FolderOpenOutlined} from "@ant-design/icons"
import {CaretDown} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
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
    const {project} = useProjectData()
    const navigateToApp = useSetAtom(routerAppNavigationAtom)

    const [dropdownOpen, setDropdownOpen] = useState(false)

    const projectId = project?.project_id
    const {data: foldersData} = useSWR(projectId ? ["folders", projectId] : null, () =>
        queryFolders({folder: {}}),
    )

    const {appMenuItems, appKeyMap} = useMemo(() => {
        const folders = foldersData?.folders ?? []
        const {roots} = buildFolderTree(folders, apps)
        const keyMap: Record<string, string> = {}

        const buildMenuItems = (nodes: FolderTreeItem[]): MenuProps["items"] => {
            return nodes.map((node) => {
                if (node.type === "folder") {
                    const children = buildMenuItems(node.children)
                    return {
                        key: `folder:${node.id}`,
                        label: (
                            <div className="flex items-center gap-2">
                                <FolderOpenOutlined style={{fontSize: 14}} />
                                <span className="truncate">{node.name}</span>
                            </div>
                        ),
                        children,
                    }
                } else {
                    const key = `app:${node.app_id}`
                    keyMap[key] = node.app_id
                    return {
                        key,
                        label: <span className="truncate">{node.app_name}</span>,
                    }
                }
            })
        }

        return {
            appMenuItems: buildMenuItems(roots),
            appKeyMap: keyMap,
        }
    }, [apps, foldersData])

    const selectedAppId = currentApp?.app_id || recentlyVisitedAppId
    const selectedKey = selectedAppId ? [`app:${selectedAppId}`] : undefined

    const handleMenuClick: MenuProps["onClick"] = ({key}) => {
        const appId = appKeyMap[key]
        if (appId) {
            setDropdownOpen(false)
            navigateToApp(appId)
        }
    }

    const appLabel = currentApp?.app_name || "Select app"

    return (
        <Dropdown
            trigger={["click"]}
            placement={collapsed ? "bottomLeft" : "bottomRight"}
            destroyOnHidden
            styles={{
                root: {
                    zIndex: 2000,
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
