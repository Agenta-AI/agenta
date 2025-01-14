import {Button, Space, Typography} from "antd"
import {FloppyDiskBack} from "@phosphor-icons/react"
import DeployButton from "../../../../assets/DeployButton"
import Version from "../../../../assets/Version"
import {PromptFocusDrawerHeaderProps} from "./types"

const PromptFocusDrawerHeader: React.FC<PromptFocusDrawerHeaderProps> = ({
    variantName,
    revision,
}) => {
    return (
        <div className="!w-full flex items-center justify-between">
            <Space className="flex items-center gap-2">
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
