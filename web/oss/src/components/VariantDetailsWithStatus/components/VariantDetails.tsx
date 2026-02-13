// no react hooks needed here beyond Jotai

import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Dropdown, Space, Tag, Typography} from "antd"
import type {MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {Variant} from "@/oss/lib/Types"
import {discardRevisionDraftAtom} from "@/oss/state/newPlayground/legacyEntityBridge"
import {latestAppRevisionIdAtom} from "@/oss/state/variant/selectors/variant"

interface VariantDetailsProps {
    variantName?: string
    revision?: number | string | null
    variant?: Pick<Variant, "isLatestRevision" | "deployedIn">
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    showLatestTag?: boolean
}

const VariantDetails = ({
    variantName,
    revision,
    variant,
    showRevisionAsTag = true,
    hasChanges = false,
    showLatestTag = true,
}: VariantDetailsProps) => {
    const latestAppRevisionId = useAtomValue(latestAppRevisionIdAtom)
    const currentRevisionId = (variant as any)?.id as string | undefined
    const isAppLatest = !!currentRevisionId && currentRevisionId === latestAppRevisionId
    const discardDraft = useSetAtom(discardRevisionDraftAtom)
    const setParamsOverride = useSetAtom(
        parametersOverrideAtomFamily(currentRevisionId || "") as any,
    )

    const handleDiscardDraft = () => {
        if (!currentRevisionId) return
        try {
            discardDraft(currentRevisionId)
            setParamsOverride(null)
            message.success("Draft changes discarded")
        } catch (e) {
            message.error("Failed to discard draft changes")
            console.error(e)
        }
    }

    const draftMenuItems: MenuProps["items"] = [
        {
            key: "discard",
            label: "Discard draft changes",
            danger: true,
            disabled: !currentRevisionId,
        },
    ]
    const onDraftMenuClick: MenuProps["onClick"] = ({key}) => {
        if (key === "discard") {
            handleDiscardDraft()
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
                isAppLatest &&
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
