import {useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"

import {useProjectPermission} from "../context/useProjectPermission"

import {useEvaluatorConfigs} from "./configuration/useEvaluatorConfigs"
import {EditEvaluationDialog} from "./EditEvaluationDialog"
import {useEditEvaluationRun} from "./useEditEvaluationRun"

/**
 * The "Edit evaluation" dialog for one run, opened from the run's menu and from the Configuration
 * tab ("Edit", "Add evaluator"). As in the old app, a live run and a closed run cannot be edited,
 * and a reader who may not edit runs cannot either: `canEdit` is false and `dialog` is null.
 */
export const useRunEditDialog = (projectId: string, runId: string, header: RunHeader) => {
    const allowed = useProjectPermission(projectId, "edit_evaluation_runs")
    const saved = useEditEvaluationRun(projectId, runId)
    const [open, setOpen] = useState(false)
    // The run's evaluators are read only while the dialog is open.
    const evaluators = useEvaluatorConfigs(open ? runId : "")
    const canEdit = allowed && header.kind !== "online" && !header.flags.isClosed

    const dialog = canEdit ? (
        <EditEvaluationDialog
            open={open}
            name={saved.name}
            description={saved.description}
            evaluators={evaluators.map((evaluator) => ({
                revisionId: evaluator.revisionId,
                name: evaluator.name,
                version: evaluator.version,
            }))}
            humanRun={header.kind === "human"}
            onClose={() => setOpen(false)}
            onSave={saved.save}
        />
    ) : null

    return {canEdit, open: () => setOpen(true), dialog}
}
