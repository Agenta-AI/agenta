import {useCallback, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, Copy, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {selectedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {clearLocalCustomPropsForRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    clearLocalPromptsForRevisionAtomFamily,
    clearLocalTransformedPromptsForRevisionAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"

import {removeVariantFromSelectionMutationAtom} from "../../../state/atoms/variantCrudMutations"
import DeleteVariantButton from "../../Modals/DeleteVariantModal/assets/DeleteVariantButton"

import {PlaygroundVariantHeaderMenuProps} from "./types"

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({
    variantId,
    ...props
}) => {
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const removeVariantFromSelection = useSetAtom(removeVariantFromSelectionMutationAtom)

    const closePanelDisabled = useMemo(() => {
        return selectedVariants.length === 1 && selectedVariants.includes(variantId)
    }, [selectedVariants, variantId])

    const handleClosePanel = useCallback(() => {
        removeVariantFromSelection(variantId)
    }, [removeVariantFromSelection, variantId])

    const clearPrompts = useSetAtom(clearLocalPromptsForRevisionAtomFamily(variantId || "") as any)
    const clearTransformed = useSetAtom(
        clearLocalTransformedPromptsForRevisionAtomFamily(variantId || "") as any,
    )
    const clearCustomProps = useSetAtom(
        clearLocalCustomPropsForRevisionAtomFamily(variantId || "") as any,
    )
    const setParamsOverride = useSetAtom(parametersOverrideAtomFamily(variantId || "") as any)

    const handleDiscardDraft: NonNullable<MenuProps["onClick"]> = (e) => {
        e?.domEvent?.stopPropagation()
        if (!variantId) return
        try {
            clearPrompts()
            clearCustomProps()
            clearTransformed()
            setParamsOverride(null)
            // Prune dynamically added variables and re-add current ones based on prompts

            message.success("Draft changes discarded")
        } catch (err) {
            message.error("Failed to discard draft changes")

            console.error(err)
        }
    }

    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "history",
                label: "History",
                icon: <ArrowCounterClockwise size={14} />,
                disabled: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
            {
                key: "rename",
                label: "Rename",
                icon: <PencilSimple size={16} />,
                disabled: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
            {type: "divider"},
            {
                key: "revert",
                label: "Revert Changes",
                icon: <ArrowCounterClockwise size={14} />,
                onClick: handleDiscardDraft,
                disabled: !variantId,
            },
            {
                key: "clone",
                label: "Clone",
                icon: <Copy size={16} />,
                disabled: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
            {
                key: "delete",
                danger: true,
                label: (
                    <DeleteVariantButton variantId={variantId}>
                        <div className="w-full h-full">Delete</div>
                    </DeleteVariantButton>
                ),
                icon: <Trash size={16} />,
            },
            {type: "divider"},
            {
                key: "reset",
                label: "Reset",
                disabled: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
            {
                key: "close",
                label: "Close panel",
                disabled: closePanelDisabled,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleClosePanel()
                },
            },
        ],
        [handleClosePanel, closePanelDisabled, variantId, handleDiscardDraft],
    )

    return (
        <Dropdown trigger={["click"]} styles={{root: {width: 170}}} menu={{items}} {...props}>
            <Button icon={<MoreOutlined size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundVariantHeaderMenu
