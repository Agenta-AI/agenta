import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {expectedInputVariables, type DraftRevision} from "./newEvaluationDraft"

/** The input variables the picked revisions expect, so the user can match a test set to them. */
export const ExpectedVariables = ({revisions}: {revisions: readonly DraftRevision[]}) => {
    const ids = useMemo(() => revisions.map((revision) => revision.id), [revisions])
    const data = useAtomValue(
        useMemo(
            () => atom((get) => ids.map((id) => get(workflowMolecule.selectors.data(id)))),
            [ids],
        ),
    )
    const names = useMemo(
        () => expectedInputVariables(data.filter((entity) => entity !== null)),
        [data],
    )
    if (names.length === 0) return null
    return (
        <p className="m-0 text-xs text-muted-foreground">
            Expected input variables for selected variant(s):{" "}
            <span className="font-mono">{names.join(", ")}</span>
        </p>
    )
}
