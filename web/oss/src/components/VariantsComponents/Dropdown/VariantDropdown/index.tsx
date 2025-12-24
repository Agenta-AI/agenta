import {memo, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"

import {VariantDropdownProps} from "../types"

const VariantDropdown = ({
    handleOpenDetails,
    handleOpenInPlayground,
    handleDeploy,
    handleDeleteVariant,
    record,
}: VariantDropdownProps) => {
    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "details",
                label: "Open details",
                icon: <Note size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleOpenDetails?.(record)
                },
            },
            {
                key: "open_variant",
                label: "Open in playground",
                icon: <Rocket size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleOpenInPlayground?.(record)
                },
            },
            {
                key: "deploy",
                label: "Deploy",
                icon: <CloudArrowUp size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleDeploy?.(record)
                },
            },
            {type: "divider"},
            {
                key: "delete_variant",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleDeleteVariant?.(record)
                },
            },
        ],
        [handleDeleteVariant, handleDeploy, handleOpenDetails, handleOpenInPlayground, record],
    )
    return (
        <Dropdown trigger={["click"]} styles={{root: {width: 180}}} menu={{items}}>
            <Button onClick={(e) => e.stopPropagation()} type="text" icon={<MoreOutlined />} />
        </Dropdown>
    )
}

export default memo(VariantDropdown)
