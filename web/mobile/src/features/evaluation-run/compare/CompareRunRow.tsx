import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Checkbox} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {readRunReferences} from "../../evaluations/list/runReferences"
import {RunStatusTag} from "../overview/RunStatusTag"

const createdLabel = (value: string | null | undefined) =>
    value
        ? new Date(value).toLocaleDateString(undefined, {
              day: "2-digit",
              month: "short",
              year: "numeric",
          })
        : null

/** One run to compare with the base run; the whole row toggles it. */
export const CompareRunRow = ({
    run,
    checked,
    onToggle,
}: {
    run: EvaluationRun
    checked: boolean
    onToggle: () => void
}) => {
    const created = createdLabel(run.created_at)
    const name = run.name?.trim() || "Untitled run"
    const references = readRunReferences(run)
    const variant = useAtomValue(
        workflowMolecule.selectors.variantLabel(references.applicationRevisionId ?? ""),
    )
    const version = references.applicationRevisionVersion
    // Runs of several revisions can share a name; the variant and version tell them apart.
    const revision = [variant, version === null ? null : `v${version}`].filter(Boolean).join(" ")
    const details = [revision, run.description?.trim()].filter(Boolean).join(" · ")
    return (
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted">
            <span className="flex min-w-0 items-start gap-2">
                <Checkbox
                    checked={checked}
                    onCheckedChange={onToggle}
                    aria-label={name}
                    className="mt-0.5"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm text-foreground">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {details || "No description"}
                    </span>
                </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
                <RunStatusTag status={run.status ?? null} />
                {created ? <span className="text-xs text-muted-foreground">{created}</span> : null}
            </span>
        </label>
    )
}
