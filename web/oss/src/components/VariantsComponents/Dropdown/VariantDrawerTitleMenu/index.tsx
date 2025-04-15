import {memo, useMemo} from "react"

import {ArrowCounterClockwise, PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import {MoreOutlined} from "@ant-design/icons"
import {VariantDrawerTitleMenuProps} from "../types"

const VariantDrawerTitleMenu = ({onClose, onRename, onReset}: VariantDrawerTitleMenuProps) => {
    const items = useMemo(
        () => [
            {
                key: "rename",
                label: "Rename",
                icon: <PencilSimple size={16} />,
                onClick: () => {
                    onClose()
                    onRename()
                },
            },
            {
                key: "reset",
                label: "Reset",
                icon: <ArrowCounterClockwise size={16} />,
                onClick: () => {
                    onReset()
                },
            },
        ],
        [],
    )

    return (
        <Dropdown trigger={["click"]} overlayStyle={{width: 180}} menu={{items}}>
            <Button type="text" icon={<MoreOutlined />} size="small" />
        </Dropdown>
    )
}

export default memo(VariantDrawerTitleMenu)
