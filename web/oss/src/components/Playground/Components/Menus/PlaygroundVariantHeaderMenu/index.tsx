import {useCallback, useMemo} from "react"

import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    selectedVariantsAtom,
    parametersOverrideAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import {discardRevisionDraftAtom} from "@/oss/state/newPlayground/legacyEntityBridge"

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

    const discardDraft = useSetAtom(discardRevisionDraftAtom)
    const setParamsOverride = useSetAtom(parametersOverrideAtomFamily(variantId || "") as any)

    const handleDiscardDraft: NonNullable<MenuProps["onClick"]> = (e) => {
        e?.domEvent?.stopPropagation()
        if (!variantId) return
        try {
            discardDraft(variantId)
            setParamsOverride(null)
            message.success("Draft changes discarded")
        } catch (err) {
            message.error("Failed to discard draft changes")
            console.error(err)
        }
    }

    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "revert",
                label: "Revert Changes",
                icon: <ArrowCounterClockwise size={14} />,
                onClick: handleDiscardDraft,
                disabled: !variantId,
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
