import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type WorkflowRevisionLike,
} from "@agenta/annotation"
import {workflowMolecule} from "@agenta/entities/workflow"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

const metricSummary = (labels: string[]) =>
    labels.length <= 3
        ? labels.join(", ")
        : `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`

/** The evaluator's own name: a revision's name can read "default" or be empty. */
const RevisionName = ({revisionId}: {revisionId: string}) => {
    const name = useAtomValue(workflowMolecule.selectors.artifactName(revisionId))
    return (
        <span className="max-w-[180px] truncate" title={name ?? undefined}>
            {name ?? "Unnamed"}
        </span>
    )
}

/** A revision row in the evaluator picker: name, version and, for a human evaluator, its metrics. */
export const renderEvaluatorRevisionLabel = (entity: unknown) => {
    const revision = entity as WorkflowRevisionLike & {id: string}
    const metrics = revision.flags?.is_feedback ? getHumanMetrics(revision) : []
    const labels = metrics.map(formatHumanMetricLabel)
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
                <RevisionName revisionId={revision.id} />
                <VersionBadge version={revision.version ?? 0} variant="chip" size="small" />
            </div>
            {labels.length > 0 ? (
                <span className="truncate text-xs text-muted-foreground" title={labels.join(", ")}>
                    {metricSummary(labels)}
                </span>
            ) : null}
        </div>
    )
}
