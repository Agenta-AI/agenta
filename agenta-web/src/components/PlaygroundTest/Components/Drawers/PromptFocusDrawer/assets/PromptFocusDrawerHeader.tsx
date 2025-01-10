import {Button, Space, Typography} from "antd"
import {CaretLeft, CaretRight, FloppyDiskBack} from "@phosphor-icons/react"
import DeployButton from "../../../../assets/DeployButton"
import Version from "../../../../assets/Version"
import {PromptFocusDrawerHeaderProps} from "./types"
import React from "react"

const PromptFocusDrawerHeader: React.FC<PromptFocusDrawerHeaderProps> = ({
    variantName,
    revision,
}) => {
    return (
        <div className="!w-full flex items-center justify-between">
            <Space className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <Button icon={<CaretLeft size={14} />} type="text" />
                    <Button icon={<CaretRight size={14} />} type="text" />
                </div>

                <Typography.Text>{variantName}</Typography.Text>
                <Version revision={revision} />
            </Space>
            <Space className="flex items-center gap-2">
                <DeployButton />

                <Button icon={<FloppyDiskBack size={14} />} type="primary">
                    Commit
                </Button>
            </Space>
        </div>
    )
}

export default PromptFocusDrawerHeader
