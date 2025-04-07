import React from "react"

import {MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Copy, FloppyDisk, Note, Rocket} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"

import {VariantDropdownProps} from "./types"

const VariantDropdown = ({
    handleOpenDetails,
    handleOpenInPlayground,
    handleDeploy,
    handleClone,
    handleCommit,
}: VariantDropdownProps) => {
    return (
        <Dropdown
            trigger={["click"]}
            overlayStyle={{width: 180}}
            menu={{
                items: [
                    {
                        key: "details",
                        label: "Open details",
                        icon: <Note size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            handleOpenDetails()
                        },
                    },
                    {
                        key: "open_variant",
                        label: "Open in playground XX",
                        icon: <Rocket size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            handleOpenInPlayground()
                        },
                    },
                    {
                        key: "deploy",
                        label: "Deploy",
                        icon: <CloudArrowUp size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            handleDeploy()
                        },
                    },
                    {
                        key: "commit",
                        label: "Commit",
                        icon: <FloppyDisk size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            handleCommit()
                        },
                    },
                    {
                        key: "clone",
                        label: "Clone",
                        icon: <Copy size={16} />,
                        onClick: (e) => {
                            e.domEvent.stopPropagation()
                            handleClone()
                        },
                    },
                ],
            }}
        >
            <Button onClick={(e) => e.stopPropagation()} type="text" icon={<MoreOutlined />} />
        </Dropdown>
    )
}

export default VariantDropdown
