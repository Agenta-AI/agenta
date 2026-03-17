import {useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {discardEntityDraft} from "../../../assets/entityHelpers"
import DeleteVariantButton from "../../Modals/DeleteVariantModal/assets/DeleteVariantButton"

import {PlaygroundVariantHeaderMenuProps} from "./types"

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({
    variantId,
    ...props
}) => {
    const selectedVariants = useAtomValue(playgroundController.selectors.entityIds())
    const removeVariantFromSelection = useSetAtom(playgroundController.actions.removeEntity)
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))

    const closePanelDisabled = useMemo(() => {
        return selectedVariants.length === 1 && selectedVariants.includes(variantId)
    }, [selectedVariants, variantId])

    const handleClosePanel = useCallback(() => {
        removeVariantFromSelection(variantId)
    }, [removeVariantFromSelection, variantId])

    const handleDiscardDraft: NonNullable<MenuProps["onClick"]> = (e) => {
        e?.domEvent?.stopPropagation()
        if (!variantId) return
        try {
            discardEntityDraft(variantId)
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
                disabled: !variantId || !isDirty,
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
        [handleClosePanel, closePanelDisabled, variantId, handleDiscardDraft, isDirty],
    )

    return (
        <Dropdown trigger={["click"]} styles={{root: {width: 170}}} menu={{items}} {...props}>
            <Button icon={<MoreOutlined size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundVariantHeaderMenu
