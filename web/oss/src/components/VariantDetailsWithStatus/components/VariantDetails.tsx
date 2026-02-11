import {DraftTag} from "@agenta/ui/components"
import {Dropdown, Space, Tag, Typography} from "antd"
import type {MenuProps} from "antd"

interface VariantDetailsProps {
    variantName?: string
    revision?: number | string | null
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    showLatestTag?: boolean
    isLatest?: boolean
    onDiscardDraft?: () => void
}

const VariantDetails = ({
    variantName,
    revision,
    showRevisionAsTag = true,
    hasChanges = false,
    showLatestTag = true,
    isLatest = false,
    onDiscardDraft,
}: VariantDetailsProps) => {
    const draftMenuItems: MenuProps["items"] = [
        {
            key: "discard",
            label: "Discard draft changes",
            danger: true,
            disabled: !onDiscardDraft,
        },
    ]
    const onDraftMenuClick: MenuProps["onClick"] = ({key}) => {
        if (key === "discard") {
            onDiscardDraft?.()
        }
    }
    return (
        <Space size={4}>
            {variantName ? <Typography>{variantName}</Typography> : null}
            {revision !== undefined &&
                (showRevisionAsTag ? (
                    <Tag className={`bg-[rgba(5,23,41,0.06)]`} variant="filled">
                        v{revision}
                    </Tag>
                ) : (
                    <Typography.Text>v{revision}</Typography.Text>
                ))}

            {hasChanges ? (
                <Dropdown
                    trigger={["click"]}
                    menu={{items: draftMenuItems, onClick: onDraftMenuClick}}
                    placement="bottomLeft"
                >
                    <DraftTag className="cursor-pointer" />
                </Dropdown>
            ) : (
                isLatest &&
                showLatestTag && (
                    <Tag className={`bg-[#E6F4FF] text-[#1677FF]`} variant="filled">
                        Last modified
                    </Tag>
                )
            )}
        </Space>
    )
}

export default VariantDetails
