import {memo, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimpleLine, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"

import {TableDropdownMenuProps} from "./types"

const TableDropdownMenu = ({
    record,
    category,
    onEdit,
    onConfigure,
    onDelete,
}: TableDropdownMenuProps) => {
    const items = useMemo(() => {
        const menuItems: MenuProps["items"] = []

        menuItems.push({
            key: "edit",
            label: "Edit evaluator",
            icon: <PencilSimpleLine size={16} />,
            onClick: (event) => {
                event.domEvent.stopPropagation()
                category === "human" ? onEdit?.(record) : onConfigure?.(record)
            },
        })

        if (menuItems.length) {
            menuItems.push({type: "divider"})
        }

        menuItems.push({
            key: "delete",
            label: "Delete",
            icon: <Trash size={16} />,
            danger: true,
            onClick: (event) => {
                event.domEvent.stopPropagation()
                onDelete(record)
            },
        })

        return menuItems
    }, [category, record])

    return (
        <Dropdown trigger={["click"]} menu={{items}} styles={{root: {width: 150}}}>
            <Button
                type="text"
                icon={<MoreOutlined />}
                onClick={(event) => event.stopPropagation()}
            />
        </Dropdown>
    )
}

export default memo(TableDropdownMenu)
