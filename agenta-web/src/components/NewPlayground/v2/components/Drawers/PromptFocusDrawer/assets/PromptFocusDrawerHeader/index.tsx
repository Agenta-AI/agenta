import {Space, Typography} from "antd"
import Version from "@/components/NewPlayground/assets/Version"
import {PromptFocusDrawerHeaderProps} from "./types"
import DeployVariantButton from "@/components/NewPlayground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import CommitVariantChangesButton from "@/components/NewPlayground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"

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
                <DeployVariantButton variantId={variantId} />

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
