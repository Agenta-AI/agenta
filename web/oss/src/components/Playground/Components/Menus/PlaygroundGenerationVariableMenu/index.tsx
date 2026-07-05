import {useCallback} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {DotsThreeVertical, Copy, Database} from "@phosphor-icons/react"

import TestsetDrawerButton from "../../Drawers/TestsetDrawer"

import {PlaygroundGenerationVariableMenuProps} from "./types"

const PlaygroundGenerationVariableMenu: React.FC<PlaygroundGenerationVariableMenuProps> = ({
    duplicateRow,
    resultHash,
}) => {
    const isResults = Array.isArray(resultHash)
        ? resultHash.filter(Boolean).length > 0
        : Boolean(resultHash)

    const handleDuplicate = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            duplicateRow()
        },
        [duplicateRow],
    )

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                <Button variant="ghost" size="icon-sm">
                    {<DotsThreeVertical size={14} />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onClick={handleDuplicate}>
                    <Copy size={14} />
                    Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!isResults}>
                    <TestsetDrawerButton
                        resultHashes={Array.isArray(resultHash) ? resultHash : [resultHash]}
                    >
                        <div className="flex items-center gap-2">
                            <Database size={14} />
                            Add to testset
                        </div>
                    </TestsetDrawerButton>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default PlaygroundGenerationVariableMenu
