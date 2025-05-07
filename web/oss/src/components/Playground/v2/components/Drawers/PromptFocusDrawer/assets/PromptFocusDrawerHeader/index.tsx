import {Space, Typography} from "antd"

import Version from "@/oss/components/Playground/assets/Version"
import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"

import {PromptFocusDrawerHeaderProps} from "./types"

const PromptFocusDrawerHeader: React.FC<PromptFocusDrawerHeaderProps> = ({
    variantName,
    revision,
    variantId,
}) => {
    return (
        <div className="!w-full flex items-center justify-between">
            <Space className="flex items-center gap-2">
                <Typography.Text>{variantName}</Typography.Text>
                <Version revision={revision} />
            </Space>
            <Space className="flex items-center gap-2">
                <DeployVariantButton revisionId={variantId} />

                <CommitVariantChangesButton
                    variantId={variantId}
                    label="Commit"
                    type="primary"
                    size="small"
                />
            </Space>
        </div>
    )
}

export default PromptFocusDrawerHeader
