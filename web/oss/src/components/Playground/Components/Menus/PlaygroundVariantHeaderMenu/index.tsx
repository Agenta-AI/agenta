import {useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {isAgentModeAtomFamily, playgroundController} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, Trash} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import DeleteVariantButton from "../../Modals/DeleteVariantModal/assets/DeleteVariantButton"

import {PlaygroundVariantHeaderMenuProps} from "./types"

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({variantId}) => {
    const selectedVariants = useAtomValue(playgroundController.selectors.entityIds())
    const removeVariantFromSelection = useSetAtom(playgroundController.actions.removeEntity)
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))
    const isAgent = useAtomValue(isAgentModeAtomFamily(variantId || ""))

    const closePanelDisabled = useMemo(() => {
        return selectedVariants.length === 1 && selectedVariants.includes(variantId)
    }, [selectedVariants, variantId])

    const handleClosePanel = useCallback(() => {
        removeVariantFromSelection(variantId)
    }, [removeVariantFromSelection, variantId])

    const handleDiscardDraft = () => {
        if (!variantId) return
        try {
            workflowMolecule.set.discard(variantId)
            message.success("Draft changes discarded")
        } catch (err) {
            message.error("Failed to discard draft changes")
            console.error(err)
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                <Button variant="ghost" size="icon">
                    {<MoreOutlined size={14} />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{width: 170}}>
                <DropdownMenuItem onClick={handleDiscardDraft} disabled={!variantId || !isDirty}>
                    <ArrowCounterClockwise size={14} />
                    Revert Changes
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <DeleteVariantButton variantId={variantId}>
                        <div className="w-full h-full flex items-center gap-2">
                            <Trash size={16} />
                            Delete
                        </div>
                    </DeleteVariantButton>
                </DropdownMenuItem>
                {!isAgent && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleClosePanel} disabled={closePanelDisabled}>
                            Close panel
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default PlaygroundVariantHeaderMenu
