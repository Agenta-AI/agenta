import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {ScenarioFocusBody} from "./ScenarioFocusBody"

import {AnnotationFormPanel} from "@/features/annotations/AnnotationFormPanel"
import {ScenarioMessage} from "@/features/annotations/ScenarioMessage"
import {useProjectPermission} from "@/features/context/useProjectPermission"

/** The scenario's own values; the evaluator scores are what the form edits. */
const CONTENT_KINDS = new Set(["testset", "application"])

/**
 * One scenario to annotate: its inputs and the app output, beside the "Annotations" form with its
 * Annotate button. The form needs the app output to link the annotation to, and the
 * `edit_annotations` permission to save; without it the values show read only.
 */
export const RunAnnotateBody = ({
    runId,
    row,
    groups,
    labels,
    onRetry,
    onSaved,
}: {
    runId: string
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    onRetry: () => void
    onSaved: (scenarioId: string) => void
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canAnnotate = useProjectPermission(projectId, "edit_annotations")
    const contentGroups = groups.filter(({group}) => CONTENT_KINDS.has(group.kind))
    const hasOutput = Boolean(row.invocation?.traceId)

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4">
            <div className="flex min-w-0 flex-col rounded-lg border border-solid border-border bg-background md:flex-1">
                <ScenarioFocusBody
                    row={row}
                    groups={contentGroups}
                    labels={labels}
                    onRetry={onRetry}
                />
            </div>
            <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background md:w-[340px] lg:w-[400px]">
                {hasOutput ? (
                    <AnnotationFormPanel
                        key={row.scenario.id}
                        scenarioId={row.scenario.id}
                        runId={runId}
                        showSubmit
                        readOnly={!canAnnotate}
                        onSaved={onSaved}
                    />
                ) : (
                    <>
                        <h2 className="m-0 border-0 border-b border-solid border-border px-3 py-2.5 text-sm font-medium">
                            Annotations
                        </h2>
                        <ScenarioMessage title="Run the invocation to generate output before annotating." />
                    </>
                )}
            </div>
        </div>
    )
}
