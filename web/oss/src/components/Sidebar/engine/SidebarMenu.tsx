import {memo, useCallback, useMemo} from "react"

import {CaretRight} from "@phosphor-icons/react"
import {Menu, Tag, Tooltip} from "antd"
import type {MenuProps} from "antd"
import clsx from "clsx"
import Link from "next/link"
import {useRouter} from "next/router"

import {SidebarConfig, SidebarMenuProps} from "./types"

type MenuItem = NonNullable<MenuProps["items"]>[number]

const SidebarMenu: React.FC<SidebarMenuProps> = ({
    items,
    menuProps,
    collapsed,
    mode = "inline",
    openKeys = [],
    onToggleOpenKey,
}) => {
    const router = useRouter()

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
                window.open(item.link, "_blank")
            } else {
                router.push(item.link)
            }
        },
        [router],
    )

    const transformItems = useCallback(
        (items: SidebarConfig[]): MenuItem[] => {
            return items.flatMap((item): MenuItem[] => {
                if (item.submenu) {
                    const titleNode = (
                        <>
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </>
                    )
                    const labelNode = item.link ? (
                        <Link
                            className="w-full"
                            href={item.link}
                            onClick={item.onClick}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
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
                            <span className="w-full">{labelNode}</span>
                        </Tooltip>
                    ) : (
                        labelNode
                    )
                    const isNavigableParent = Boolean(item.link)
                    const isOpen = openKeys.includes(item.key)

                    return [
                        {
                            key: item.key,
                            icon: item.icon,
                            label: submenuLabel,
                            children: transformItems(item.submenu),
                            popupClassName:
                                "max-h-[min(70vh,560px)] overflow-y-auto [&_.ant-menu-sub_>_.ant-menu-item]:flex [&_.ant-menu-sub_>_.ant-menu-item]:items-center",
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
                                if (collapsed && isNavigableParent) {
                                    navigateToItem(item, domEvent)
                                    return
                                }

                                item.onClick?.(domEvent as React.MouseEvent)
                            },
                            title: item.title,
                            expandIcon:
                                isNavigableParent && !collapsed
                                    ? ({isOpen: menuIsOpen}: {isOpen?: boolean}) => (
                                          <span
                                              role="button"
                                              tabIndex={0}
                                              aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.title}`}
                                              className="flex h-full items-center justify-center px-1 text-gray-400 hover:text-gray-700"
                                              onClick={(event) => {
                                                  event.preventDefault()
                                                  event.stopPropagation()
                                                  onToggleOpenKey?.(item.key)
                                              }}
                                              onKeyDown={(event) => {
                                                  if (event.key !== "Enter" && event.key !== " ")
                                                      return

                                                  event.preventDefault()
                                                  event.stopPropagation()
                                                  onToggleOpenKey?.(item.key)
                                              }}
                                          >
                                              <CaretRight
                                                  size={12}
                                                  className={clsx(
                                                      "transition-transform",
                                                      (menuIsOpen ?? isOpen) && "rotate-90",
                                                  )}
                                              />
                                          </span>
                                      )
                                    : undefined,
                        },
                    ]
                } else {
                    const node = item.link ? (
                        <Link
                            className="w-full"
                            href={item.link}
                            onClick={item.onClick}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                        >
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </Link>
                    ) : (
                        <span className="w-full" onClick={item.onClick}>
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
                            <Tooltip title={item.tooltip} placement="right" mouseEnterDelay={0.8}>
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
        [collapsed, navigateToItem, onToggleOpenKey, openKeys],
    )

    return (
        <Menu
            mode={mode}
            items={transformItems(items)}
            {...(mode === "inline" ? {inlineCollapsed: collapsed} : {})}
            {...menuProps}
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
                "!overflow-x-hidden",
                // The menu shouldn't paint its own surface — let it inherit the
                // sidebar background so it doesn't read as a lighter band in dark
                // mode (no-op in light, where the sidebar is already white).
                "!bg-transparent [&_.ant-menu-sub]:!bg-transparent",
                "[&_.ant-menu-item]:flex [&_.ant-menu-item]:items-center",
                "[&_.ant-menu-submenu-title]:flex [&_.ant-menu-submenu-title]:items-center",
                "[&_.ant-menu-item-icon]:!shrink-0",
                "!border-0 [&_.ant-menu-item-divider]:!w-full [&_.ant-menu-item-divider]:!my-2",
                {
                    "[&_.ant-menu-item]:!w-[94%] [&_.ant-menu-item]:!mx-2 [&_.ant-menu-item]:!pl-3 [&_.ant-menu-submenu-title]:!pl-3 [&_.ant-menu-submenu-title]:!w-[94%] [&_.ant-menu-submenu-title]:!mx-2":
                        !collapsed,
                    "[&_.ag-sidebar-submenu-inline>.ant-menu-sub.ant-menu-inline]:!ml-2 [&_.ag-sidebar-submenu-inline>.ant-menu-sub.ant-menu-inline]:!pl-2":
                        !collapsed,
                    "[&_.ag-sidebar-submenu-open]:relative [&_.ag-sidebar-submenu-open]:before:pointer-events-none [&_.ag-sidebar-submenu-open]:before:absolute [&_.ag-sidebar-submenu-open]:before:left-[22px] [&_.ag-sidebar-submenu-open]:before:top-[40px] [&_.ag-sidebar-submenu-open]:before:bottom-2 [&_.ag-sidebar-submenu-open]:before:w-px [&_.ag-sidebar-submenu-open]:before:bg-gray-200 [&_.ag-sidebar-submenu-open]:before:content-['']":
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
