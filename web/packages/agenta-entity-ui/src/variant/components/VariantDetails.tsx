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
    hideDiscard?: boolean
}

const VariantDetails = ({
    variantName,
    revision,
    showRevisionAsTag = true,
    hasChanges = false,
    showLatestTag = true,
    isLatest = false,
    onDiscardDraft,
    hideDiscard = false,
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
                revision !== null &&
                revision !== "" &&
                (showRevisionAsTag ? (
                    <Tag className={`bg-[var(--ag-colorFillSecondary)]`} variant="filled">
                        v{revision}
                    </Tag>
                ) : (
                    <Typography.Text>v{revision}</Typography.Text>
                ))}

            {hasChanges ? (
                hideDiscard ? (
                    <DraftTag />
                ) : (
                    <Dropdown
                        trigger={["click"]}
                        menu={{items: draftMenuItems, onClick: onDraftMenuClick}}
                        placement="bottomLeft"
                    >
                        <DraftTag className="cursor-pointer" />
                    </Dropdown>
                )
            ) : (
                isLatest &&
                showLatestTag && (
                    <Tag
                        className={`bg-[var(--ag-c-E6F4FF)] text-[var(--ag-c-1677FF)]`}
                        variant="filled"
                    >
                        Last modified
                    </Tag>
                )
            )}
        </Space>
    )
}

export default VariantDetails
