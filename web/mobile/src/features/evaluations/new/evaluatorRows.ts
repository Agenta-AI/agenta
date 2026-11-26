import type {EvaluatorEntry, Workflow} from "@agenta/entities/workflow"

import {toRevisionRow, type EvaluatorRevisionRow} from "../../evaluators/evaluatorsView"

/**
 * Every listed evaluator's revisions as rows, newest first per evaluator, in list order. An
 * evaluator whose revisions have not loaded yet shows its latest revision alone. Revision 0 is
 * the empty first commit and is left out.
 */
export const toEvaluatorRows = (
    entries: readonly EvaluatorEntry[],
    revisions: readonly Workflow[],
): EvaluatorRevisionRow[] => {
    const byWorkflow = new Map<string, Workflow[]>()
    for (const revision of revisions) {
        if (!revision.workflow_id || !(revision.version && revision.version > 0)) continue
        byWorkflow.set(revision.workflow_id, [
            ...(byWorkflow.get(revision.workflow_id) ?? []),
            revision,
        ])
    }
    return entries.flatMap(({workflow, latestRevision}) => {
        const own = (byWorkflow.get(workflow.id) ?? [latestRevision]).sort(
            (a, b) => (b.version ?? 0) - (a.version ?? 0),
        )
        return own.map((revision) => toRevisionRow(revision, workflow, latestRevision))
    })
}
