import {memo, useCallback, useMemo, useState} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {useAppsData} from "@/oss/state/app"
import {routerAppNavigationAtom} from "@/oss/state/app/atoms/fetcher"
import {useAppState} from "@/oss/state/appState"
import {currentWorkflowAtom} from "@/oss/state/workflow"

interface ListOfAppsProps {
    collapsed: boolean
}

const ListOfApps = ({collapsed}: ListOfAppsProps) => {
    const {currentApp, apps, recentlyVisitedAppId} = useAppsData()
    const {appId: routedAppId} = useAppState()
    const navigateToApp = useSetAtom(routerAppNavigationAtom)
    // The dropdown LIST stays apps-only (apps switcher). But the displayed
    // LABEL needs to resolve evaluator names too — when the user is on
    // /apps/[evaluator_id]/* the URL ID isn't in `apps`, so without this
    // fallback the button shows the raw UUID instead of the evaluator's
    // name.
    const currentWorkflow = useAtomValue(currentWorkflowAtom)

    const [dropdownOpen, setDropdownOpen] = useState(false)

    const {appMenuItems, appKeyMap} = useMemo(() => {
        const keyMap: Record<string, string> = {}
        const items: MenuProps["items"] = (apps ?? []).map((app) => {
            const key = `app:${app.id}`
            const label = app.name ?? app.slug ?? app.id
            keyMap[key] = app.id
            return {
                key,
                label: (
                    <div className="w-full max-w-[400px]">
                        <span className="truncate block" title={label}>
                            {label}
                        </span>
                    </div>
                ),
            }
        })

        return {appMenuItems: items, appKeyMap: keyMap}
    }, [apps])

    const selectedAppId = currentApp?.id || routedAppId || recentlyVisitedAppId
    const selectedKey = selectedAppId ? [`app:${selectedAppId}`] : undefined

    const handleMenuClick: MenuProps["onClick"] = useCallback(
        ({key}: {key: string}) => {
            const appId = appKeyMap[key]
            if (appId) {
                setDropdownOpen(false)
                navigateToApp(appId)
            }
        },
        [appKeyMap, navigateToApp],
    )

    const appLabel =
        currentApp?.name ??
        currentApp?.slug ??
        currentWorkflow?.name ??
        currentWorkflow?.slug ??
        (selectedAppId && (apps?.find((app) => app.id === selectedAppId)?.name ?? selectedAppId)) ??
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
