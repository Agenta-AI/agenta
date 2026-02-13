import {memo, useCallback} from "react"

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

                    return [menuItem, item.divider && {type: "divider"}]
                }
            })
        },
        [items, collapsed],
    )

    return (
        <Menu
            mode={mode}
            items={transformItems(items)}
            {...(mode === "inline" ? {inlineCollapsed: collapsed} : {})}
            {...menuProps}
            className={clsx([
                "!overflow-x-hidden",
                "[&_.ant-menu-item]:flex [&_.ant-menu-item]:items-center",
                "[&_.ant-menu-submenu-title]:flex [&_.ant-menu-submenu-title]:items-center",
                "[&_.ant-menu-item-icon]:!shrink-0",
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
