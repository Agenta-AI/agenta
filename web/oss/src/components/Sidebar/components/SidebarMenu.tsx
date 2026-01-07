import {memo, useCallback, useMemo} from "react"

import {Menu, Tag, Tooltip} from "antd"
import clsx from "clsx"
import Link from "next/link"

import {SidebarConfig, SidebarMenuProps} from "../types"

const SidebarMenu: React.FC<SidebarMenuProps> = ({
    items,
    menuProps,
    collapsed,
    mode = "inline",
}) => {
    const clickHandlers = useMemo(() => {
        const map = new Map<string, {onClick?: (e: React.MouseEvent) => void; hasLink: boolean}>()
        const walk = (list: SidebarConfig[]) => {
            list.forEach((item) => {
                if (item.submenu) {
                    walk(item.submenu)
                    return
                }
                if (item.header) return
                map.set(item.key, {onClick: item.onClick, hasLink: Boolean(item.link)})
            })
        }
        walk(items)
        return map
    }, [items])

    const transformItems = useCallback(
        (items: SidebarConfig[]): any => {
            return items.flatMap((item): any => {
                const icon = item.icon ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 shrink-0">
                        {item.icon}
                    </span>
                ) : undefined
                if (item.submenu) {
                    return {
                        key: item.key,
                        icon,
                        label: (
                            <>
                                {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                            </>
                        ),
                        children: transformItems(item.submenu),
                        popupClassName:
                            "[&_.ant-menu-sub_>_.ant-menu-item]:flex [&_.ant-menu-sub_>_.ant-menu-item]:items-center",
                        className: clsx({
                            "[&_.ant-menu-submenu-arrow]:hidden [&_.ant-menu-title-content]:hidden":
                                collapsed,
                        }),
                        disabled: item.isCloudFeature || item.disabled,
                        onTitleClick: item.onClick,
                        title: item.title,
                    }
                } else if (item.header) {
                    return {
                        type: "group",
                        label: (
                            <div
                                key={item.key}
                                className={clsx("w-full text-gray-500 !truncate", {
                                    "!w-[62px] pl-2": collapsed,
                                })}
                            >
                                {item.title}
                            </div>
                        ),
                    }
                } else {
                    const node = item.link ? (
                        <Link
                            className="w-full block"
                            href={item.link}
                            onClick={item.onClick}
                            target={item.link?.startsWith("http") ? "_blank" : undefined}
                        >
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </Link>
                    ) : (
                        <span className="w-full block" onClick={item.onClick}>
                            {item.title} {item.tag && <Tag color="lime">{item.tag}</Tag>}
                        </span>
                    )

                    const menuItem = {
                        icon,
                        key: item.key,
                        disabled: item.disabled,
                        danger: item.danger,
                        label: collapsed ? (
                            <Tooltip title={item.tooltip} placement="right" mouseEnterDelay={0.8}>
                                <div className="flex items-center justify-center w-full">
                                    {node}
                                </div>
                            </Tooltip>
                        ) : (
                            node
                        ),
                    }

                    return [menuItem, item.divider && {type: "divider"}]
                }
            })
        },
        [items, collapsed],
    )

    const {onClick: menuOnClick, ...restMenuProps} = menuProps || {}

    return (
        <Menu
            mode={mode}
            items={transformItems(items)}
            onClick={(info) => {
                const handler = clickHandlers.get(info.key as string)
                if (handler?.onClick && !handler.hasLink) {
                    handler.onClick(info.domEvent as unknown as React.MouseEvent)
                }
                menuOnClick?.(info)
            }}
            {...(mode === "inline" ? {inlineCollapsed: collapsed} : {})}
            {...restMenuProps}
            className={clsx([
                "!overflow-x-hidden",
                "[&_.ant-menu-item]:flex [&_.ant-menu-item]:items-center",
                "[&_.ant-menu-submenu-title]:flex [&_.ant-menu-submenu-title]:items-center",
                "!border-0 [&_.ant-menu-item-divider]:!w-full [&_.ant-menu-item-divider]:!my-2",
                {
                    "[&_.ant-menu-item]:!w-[94%] [&_.ant-menu-item]:!mx-2 [&_.ant-menu-item]:!pl-3 [&_.ant-menu-submenu-title]:!pl-3 [&_.ant-menu-submenu-title]:!w-[94%] [&_.ant-menu-submenu-title]:!mx-2":
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
