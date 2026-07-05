import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {Trash} from "@phosphor-icons/react"
import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type WorkflowRevisionLike,
} from "./EntityEvaluatorSelector"

export interface SelectedEvaluatorCardData {
    revisionId: string
    evaluatorName: string
    version: number
    isHuman: boolean
}

interface SelectedEvaluatorCardProps {
    evaluator: SelectedEvaluatorCardData
    onRemove: (revisionId: string) => void
    disabled?: boolean
}

export default function SelectedEvaluatorCard({
    evaluator,
    onRemove,
    disabled = false,
}: SelectedEvaluatorCardProps) {
    const revisionData = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.data(evaluator.revisionId),
            [evaluator.revisionId],
        ),
    ) as WorkflowRevisionLike | null

    const metrics = useMemo(() => {
        if (!evaluator.isHuman || !revisionData) return []
        return getHumanMetrics(revisionData)
    }, [evaluator.isHuman, revisionData])

    return (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-gray-100 px-3 py-3">
            <div className="min-w-0 flex-1">
                <span className="block">
                    {evaluator.evaluatorName} - v{evaluator.version}
                </span>
                {metrics.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {metrics.map((metric) => (
                            <Tag key={metric.name} className="!m-0 bg-gray-200">
                                {formatHumanMetricLabel(metric)}
                            </Tag>
                        ))}
                    </div>
                ) : null}
            </div>
            <Button
                aria-label={`Remove ${evaluator.evaluatorName}`}
                disabled={disabled}
                onClick={() => onRemove(evaluator.revisionId)}
                variant="destructive"
                size="icon-sm"
            >
                {<Trash size={14} />}
            </Button>
        </div>
    )
}
