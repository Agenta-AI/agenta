import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {expectedInputVariables, type DraftRevision} from "./newEvaluationDraft"

/** The input variables the picked revisions expect. */
export const useExpectedInputVariables = (revisions: readonly DraftRevision[]): string[] => {
    const ids = useMemo(() => revisions.map((revision) => revision.id), [revisions])
    const data = useAtomValue(
        useMemo(
            () => atom((get) => ids.map((id) => get(workflowMolecule.selectors.data(id)))),
            [ids],
        ),
    )
    return useMemo(() => expectedInputVariables(data.filter((entity) => entity !== null)), [data])
}
