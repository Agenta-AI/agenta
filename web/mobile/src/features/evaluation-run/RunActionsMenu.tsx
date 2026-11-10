import type {RunHeader} from "@agenta/entities/evaluationRun"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical, PencilSimple} from "@phosphor-icons/react"

import {useRunEditDialog} from "./useRunEditDialog"

/**
 * The run's "⋮" menu next to its name, with "Edit evaluation". As in the old app, a live run and
 * a closed run have no menu; a reader who may not edit runs gets none either.
 */
export const RunActionsMenu = ({
    projectId,
    runId,
    header,
}: {
    projectId: string
    runId: string
    header: RunHeader
}) => {
    const edit = useRunEditDialog(projectId, runId, header)

    if (!edit.canEdit) return null

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Run actions">
                        <DotsThreeVertical aria-hidden size={18} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={edit.open}>
                        <PencilSimple aria-hidden size={16} />
                        Edit evaluation
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {edit.dialog}
        </>
    )
}
