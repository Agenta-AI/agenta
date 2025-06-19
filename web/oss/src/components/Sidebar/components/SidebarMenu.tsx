import {useCallback} from "react"

import {Menu, Tag, Tooltip} from "antd"
import clsx from "clsx"
import Link from "next/link"

import {useStyles} from "../assets/styles"
import {SidebarConfig, SidebarMenuProps} from "../types"

const SidebarMenu: React.FC<SidebarMenuProps> = ({
    items,
    menuProps,
    collapsed,
    mode = "inline",
}) => {
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
                        popupClassName:
                            "[&_.ant-menu-sub_>_.ant-menu-item]:flex [&_.ant-menu-sub_>_.ant-menu-item]:items-center",
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
                            className="w-full"
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

    return (
        <Menu
            mode={mode}
            items={transformItems(items)}
            {...(mode === "inline" ? {inlineCollapsed: collapsed} : {})}
            {...menuProps}
            className={clsx(
                "[&_.ant-menu-item]:flex [&_.ant-menu-item]:items-center",
                "[&_.ant-menu-submenu-title]:flex [&_.ant-menu-submenu-title]:items-center",
                menuProps?.className,
            )}
        />
    )
}

export default SidebarMenu
