// no react hooks needed here beyond Jotai

import {PencilSimpleLine} from "@phosphor-icons/react"
import {Dropdown, Space, Tag, Typography, message} from "antd"
import type {MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {forceSyncPromptVariablesToNormalizedAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
import {Variant} from "@/oss/lib/Types"
import {clearLocalCustomPropsForRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {clearLocalPromptsForRevisionAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {latestAppRevisionIdAtom} from "@/oss/state/variant/selectors/variant"

interface VariantDetailsProps {
    variantName?: string
    revision?: number | string | null
    variant?: Pick<Variant, "isLatestRevision" | "deployedIn">
    showRevisionAsTag?: boolean
    hasChanges?: boolean
}

const VariantDetails = ({
    variantName,
    revision,
    variant,
    showRevisionAsTag = true,
    hasChanges = false,
}: VariantDetailsProps) => {
    const latestAppRevisionId = useAtomValue(latestAppRevisionIdAtom)
    const currentRevisionId = (variant as any)?.id as string | undefined
    const isAppLatest = !!currentRevisionId && currentRevisionId === latestAppRevisionId
    const clearLocalPrompts = useSetAtom(
        clearLocalPromptsForRevisionAtomFamily(currentRevisionId || "") as any,
    )
    const clearLocalCustomProps = useSetAtom(
        clearLocalCustomPropsForRevisionAtomFamily(currentRevisionId || "") as any,
    )
    const setParamsOverride = useSetAtom(
        parametersOverrideAtomFamily(currentRevisionId || "") as any,
    )
    const forceSync = useSetAtom(forceSyncPromptVariablesToNormalizedAtom)

    const handleDiscardDraft = () => {
        if (!currentRevisionId) return
        try {
            // Clear local prompt edits and JSON override for this revision
            clearLocalPrompts()
            clearLocalCustomProps()
            setParamsOverride(null)
            forceSync()
            message.success("Draft changes discarded")
        } catch (e) {
            // Non-blocking: ensure UX feedback even if something goes wrong
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
                    <Tag className={`bg-[rgba(5,23,41,0.06)]`} bordered={false}>
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
                    <Tag
                        color="#586673"
                        bordered={false}
                        className="flex items-center gap-1 font-normal cursor-pointer"
                    >
                        <PencilSimpleLine size={14} /> Draft
                    </Tag>
                </Dropdown>
            ) : (
                isAppLatest && (
                    <Tag className={`bg-[#E6F4FF] text-[#1677FF]`} bordered={false}>
                        Last modified
                    </Tag>
                )
            )}
        </Space>
    )
}

export default VariantDetails
