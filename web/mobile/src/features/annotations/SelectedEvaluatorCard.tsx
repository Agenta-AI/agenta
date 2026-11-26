import {useMemo} from "react"

import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type WorkflowRevisionLike,
} from "@agenta/annotation"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Badge, Button} from "@agenta/ui/ui"
import {TrashIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {SelectedEvaluator} from "./createQueueTypes"

/** One picked evaluator: name, version and, for a human evaluator, its metric chips. */
export const SelectedEvaluatorCard = ({
    evaluator,
    disabled,
    onRemove,
}: {
    evaluator: SelectedEvaluator
    disabled?: boolean
    onRemove: (revisionId: string) => void
}) => {
    const revision = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.data(evaluator.revisionId),
            [evaluator.revisionId],
        ),
    ) as WorkflowRevisionLike | null
    const metrics = useMemo(
        () => (evaluator.isHuman && revision ? getHumanMetrics(revision) : []),
        [evaluator.isHuman, revision],
    )

    return (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-3">
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                    {evaluator.evaluatorName} - v{evaluator.version}
                </span>
                {metrics.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {metrics.map((metric) => (
                            <Badge key={metric.name}>{formatHumanMetricLabel(metric)}</Badge>
                        ))}
                    </div>
                ) : null}
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${evaluator.evaluatorName}`}
                disabled={disabled}
                onClick={() => onRemove(evaluator.revisionId)}
            >
                <TrashIcon />
            </Button>
        </div>
    )
}
