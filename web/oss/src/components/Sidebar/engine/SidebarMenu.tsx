import {memo, useCallback, useMemo, useRef} from "react"

import {CaretRight} from "@phosphor-icons/react"
import {Menu, Skeleton, Tag, Tooltip} from "antd"
import type {MenuProps} from "antd"
import clsx from "clsx"
import Link from "next/link"
import {useRouter} from "next/router"

import {SidebarConfig, SidebarMenuProps} from "./types"

type MenuItem = NonNullable<MenuProps["items"]>[number]

const MENU_LINK_CLASS_NAME =
    "w-full !text-inherit hover:!text-inherit focus:!text-inherit active:!text-inherit no-underline"

const SidebarMenu: React.FC<SidebarMenuProps> = ({
    items,
    menuProps,
    collapsed,
    mode = "inline",
    openKeys = [],
    onToggleOpenKey,
    onPopupOpenChange,
}) => {
    const router = useRouter()
    const reportedOpenKeysRef = useRef<string[]>(openKeys)

    const linkMap = useMemo(() => {
        const map: Record<string, SidebarConfig> = {}
        const collect = (items: SidebarConfig[]) => {
            items.forEach((item) => {
                if (item.link || item.onClick) map[item.key] = item
                if (item.submenu) collect(item.submenu)
            })
        }
        collect(items)
        return map
    }, [items])

    const navigateToItem = useCallback(
        (item: SidebarConfig, event?: React.MouseEvent | React.KeyboardEvent) => {
            item.onClick?.(event as React.MouseEvent)

            if (!item.link) return

            if (item.link.startsWith("http")) {
                window.open(item.link, "_blank", "noopener,noreferrer")
            } else {
                router.push(item.link)
            }
        },
        [router],
    )

    const reportOpenKeyChanges = useCallback(
        (nextOpenKeys: string[]) => {
            if (!onPopupOpenChange) return

            const previousKeys = new Set(reportedOpenKeysRef.current)
            const nextKeys = new Set(nextOpenKeys)

            nextOpenKeys.forEach((key) => {
                if (!previousKeys.has(key)) onPopupOpenChange(key, true)
            })

            reportedOpenKeysRef.current.forEach((key) => {
                if (!nextKeys.has(key)) onPopupOpenChange(key, false)
            })

            reportedOpenKeysRef.current = nextOpenKeys
        },
        [onPopupOpenChange],
    )

    const handleOpenChange = useCallback(
        (nextOpenKeys: string[]) => {
            reportOpenKeyChanges(nextOpenKeys)
            menuProps?.onOpenChange?.(nextOpenKeys)
        },
        [menuProps, reportOpenKeyChanges],
    )

    const transformItems = useCallback(
        (items: SidebarConfig[]): MenuItem[] => {
            return items.flatMap((item): MenuItem[] => {
                if (item.submenu && !(collapsed && item.isDynamic)) {
                    const titleNode = (
                        <>
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </>
                    )
                    const labelNode = item.link ? (
                        <Link
                            className={MENU_LINK_CLASS_NAME}
                            href={item.link}
                            onClick={(event) => {
                                event.stopPropagation()
                                item.onClick?.(event)
                            }}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                            rel={item.link?.startsWith("http") ? "noopener noreferrer" : undefined}
                        >
                            {titleNode}
                        </Link>
                    ) : (
                        titleNode
                    )
                    const submenuLabel = collapsed ? (
                        <Tooltip
                            title={item.tooltip || item.title}
                            placement="right"
                            mouseEnterDelay={0.8}
                        >
                            <span
                                className="w-full"
                                onMouseEnter={() => onPopupOpenChange?.(item.key, true)}
                            >
                                {labelNode}
                            </span>
                        </Tooltip>
                    ) : (
                        labelNode
                    )
                    const isNavigableParent = Boolean(item.link)
                    const isOpen = openKeys.includes(item.key)
                    const isInlineMode = mode === "inline"
                    const renderExpandToggle = ({isOpen: menuIsOpen}: {isOpen?: boolean}) => {
                        const isExpanded = isInlineMode ? (menuIsOpen ?? isOpen) : false

                        return (
                            <span
                                role={isInlineMode ? "button" : undefined}
                                tabIndex={isInlineMode ? 0 : -1}
                                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.title}`}
                                className={clsx(
                                    "flex self-stretch w-8 shrink-0 items-center justify-center rounded text-gray-400 transition-colors",
                                    isInlineMode
                                        ? "hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-white/10"
                                        : "pointer-events-none",
                                )}
                                onClick={(event) => {
                                    if (!isInlineMode) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onToggleOpenKey?.(item.key)
                                }}
                                onKeyDown={(event) => {
                                    if (!isInlineMode) return
                                    if (event.key !== "Enter" && event.key !== " ") return

                                    event.preventDefault()
                                    event.stopPropagation()
                                    onToggleOpenKey?.(item.key)
                                }}
                            >
                                <CaretRight
                                    size={12}
                                    className={clsx(
                                        "transition-transform duration-200 ease-in-out",
                                        isExpanded && "rotate-90",
                                    )}
                                />
                            </span>
                        )
                    }

                    return [
                        {
                            key: item.key,
                            icon: item.icon,
                            label: submenuLabel,
                            children: transformItems(item.submenu),
                            popupClassName:
                                "max-h-[min(70vh,560px)] max-w-[min(50vw,220px)] relative !overflow-visible !shadow-none before:pointer-events-none before:absolute before:left-[-6px] before:top-6 before:z-10 before:block before:size-3 before:rotate-45 before:border-b before:border-l before:border-solid before:border-[var(--ant-color-border-secondary)] before:bg-[var(--ant-color-bg-elevated)] before:content-[''] [&_.ant-menu]:max-h-[min(70vh,560px)] [&_.ant-menu]:overflow-y-auto [&_.ant-menu]:!shadow-[8px_8px_24px_rgba(15,23,42,0.10),0_2px_8px_rgba(15,23,42,0.06)] [&_.ant-menu-sub_>_.ant-menu-item]:flex [&_.ant-menu-sub_>_.ant-menu-item]:items-center",
                            className: clsx("ag-sidebar-submenu", {
                                "ag-sidebar-submenu-inline": mode === "inline",
                                "ag-sidebar-submenu-open": mode === "inline" && isOpen,
                                "[&_.ant-menu-submenu-arrow]:hidden": collapsed,
                            }),
                            disabled: item.isCloudFeature || item.disabled,
                            onTitleClick: ({
                                domEvent,
                            }: {
                                domEvent:
                                    | React.MouseEvent<HTMLElement>
                                    | React.KeyboardEvent<HTMLElement>
                            }) => {
                                if (isNavigableParent) {
                                    navigateToItem(item, domEvent)
                                    return
                                }

                                item.onClick?.(domEvent as React.MouseEvent)
                            },
                            title: item.title,
                            expandIcon: !collapsed ? renderExpandToggle : undefined,
                        },
                    ]
                } else {
                    const labelClassName = clsx("w-full", item.isPlaceholder && "text-gray-400")
                    const node = item.isLoading ? (
                        <span className={labelClassName}>
                            <Skeleton.Button
                                active
                                size="small"
                                block
                                className="!h-4 !min-w-[72px]"
                            />
                        </span>
                    ) : item.link ? (
                        <Link
                            className={clsx(
                                MENU_LINK_CLASS_NAME,
                                item.isPlaceholder && "text-gray-400",
                            )}
                            href={item.link}
                            onClick={item.onClick}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                            rel={item.link?.startsWith("http") ? "noopener noreferrer" : undefined}
                        >
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </Link>
                    ) : (
                        <span className={labelClassName} onClick={item.onClick}>
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </span>
                    )

                    const labelNode = item.dataTour ? (
                        <span className="w-full" data-tour={item.dataTour}>
                            {node}
                        </span>
                    ) : (
                        node
                    )

                    const menuItem = {
                        icon: item.icon,
                        key: item.key,
                        disabled: item.disabled,
                        label: collapsed ? (
                            <Tooltip
                                title={item.tooltip || item.title}
                                placement="right"
                                mouseEnterDelay={0.8}
                            >
                                <div className="flex items-center justify-center w-full">
                                    {labelNode}
                                </div>
                            </Tooltip>
                        ) : (
                            labelNode
                        ),
                    }

                    return item.divider
                        ? [menuItem, {type: "divider", key: `${item.key}-divider`}]
                        : [menuItem]
                }
            })
        },
        [collapsed, navigateToItem, onPopupOpenChange, onToggleOpenKey, openKeys],
    )

    return (
        <Menu
            mode={mode}
            items={transformItems(items)}
            {...(mode === "inline" ? {inlineCollapsed: collapsed} : {})}
            {...menuProps}
            onOpenChange={(keys) => handleOpenChange(keys as string[])}
            onClick={(info) => {
                menuProps?.onClick?.(info)
                if (collapsed) {
                    const item = linkMap[info.key]
                    if (item?.onClick) {
                        item.onClick(info.domEvent as React.MouseEvent)
                    } else if (item?.link) {
                        navigateToItem(item, info.domEvent)
                    }
                }
            }}
            className={clsx([
                "!overflow-x-hidden select-none [&_*]:select-none",
                // The menu shouldn't paint its own surface — let it inherit the
                // sidebar background so it doesn't read as a lighter band in dark
                // mode (no-op in light, where the sidebar is already white).
                "!bg-transparent [&_.ant-menu-sub]:!bg-transparent",
                "[&_.ant-menu-item]:flex [&_.ant-menu-item]:items-center",
                "[&_.ant-menu-submenu-title]:flex [&_.ant-menu-submenu-title]:items-center",
                "[&_.ant-menu-item-icon]:!shrink-0",
                "!border-0 [&_.ant-menu-item-divider]:!w-full [&_.ant-menu-item-divider]:!my-2",
                {
                    "[&_.ant-menu-item]:!w-[94%] [&_.ant-menu-item]:!mx-2 [&_.ant-menu-item]:!pl-3 [&_.ant-menu-submenu-title]:!pl-3 [&_.ant-menu-submenu-title]:!pr-0 [&_.ant-menu-submenu-title]:!w-[94%] [&_.ant-menu-submenu-title]:!mx-2":
                        !collapsed,
                    "[&_.ag-sidebar-submenu-inline>.ant-menu-sub.ant-menu-inline]:!ml-2 [&_.ag-sidebar-submenu-inline>.ant-menu-sub.ant-menu-inline]:!pl-2":
                        !collapsed,
                    "[&_.ag-sidebar-submenu-open]:relative [&_.ag-sidebar-submenu-open]:before:pointer-events-none [&_.ag-sidebar-submenu-open]:before:absolute [&_.ag-sidebar-submenu-open]:before:left-[22px] [&_.ag-sidebar-submenu-open]:before:top-[35px] [&_.ag-sidebar-submenu-open]:before:bottom-2 [&_.ag-sidebar-submenu-open]:before:w-px [&_.ag-sidebar-submenu-open]:before:bg-gray-200 [&_.ag-sidebar-submenu-open]:before:content-['']":
                        !collapsed,
                },
                {
                    "[&_.ant-menu-item]:!px-2 [&_.ant-menu-item]:!w-[28px] [&_.ant-menu-item]:!mx-auto [&_.ant-menu-item]:!flex [&_.ant-menu-item]:!items-center [&_.ant-menu-item]:!justify-center":
                        collapsed,
                    "[&_.ant-menu-title-content]:!opacity-0 [&_.ant-menu-title-content]:!duration-0 [&_.ant-menu-title-content]:absolute [&_.ant-menu-title-content]:top-0 [&_.ant-menu-title-content]:left-0 [&_.ant-menu-title-content]:right-0 [&_.ant-menu-title-content]:bottom-0":
                        collapsed,
                    "[&_.ant-menu-submenu-title]:!w-[28px] [&_.ant-menu-submenu-title]:!mx-auto [&_.ant-menu-submenu-title]:!p-2 [&_.ant-menu-submenu-title]:!flex [&_.ant-menu-submenu-title]:!items-center [&_.ant-menu-submenu-title]:!justify-center":
                        collapsed,
                },
                menuProps?.className,
            ])}
        />
    )
}

export default memo(SidebarMenu)
