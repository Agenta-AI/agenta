import {Menu, Tag, Tooltip} from "antd"
import Link from "next/link"
import {SidebarConfig, SidebarMenuProps} from "../types"
import {useStyles} from "../assets/styles"
import {useCallback} from "react"

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
                            data-cy={item.key}
                            className={classes.menuLinks}
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

    return <Menu mode={mode} items={transformItems(items)} {...menuProps} />
}

export default SidebarMenu
