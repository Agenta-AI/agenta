import {useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical, PencilSimple} from "@phosphor-icons/react"

import {useProjectPermission} from "../context/useProjectPermission"

import {EditEvaluationDialog} from "./EditEvaluationDialog"
import {useEditEvaluationRun} from "./useEditEvaluationRun"

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
    const canEdit = useProjectPermission(projectId, "edit_evaluation_runs")
    const saved = useEditEvaluationRun(projectId, runId)
    const [editing, setEditing] = useState(false)

    if (!canEdit || header.kind === "online" || header.flags.isClosed) return null

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Run actions">
                        <DotsThreeVertical aria-hidden size={18} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                        <PencilSimple aria-hidden size={16} />
                        Edit evaluation
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <EditEvaluationDialog
                open={editing}
                name={saved.name}
                description={saved.description}
                onClose={() => setEditing(false)}
                onSave={saved.save}
            />
        </>
    )
}
