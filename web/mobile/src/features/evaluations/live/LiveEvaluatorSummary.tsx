import {evaluatorOutputKeys} from "@agenta/entities/evaluationRun"
import {parseWorkflowKeyFromUri, type Workflow} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"

/** What the picked evaluator is: its type and the metrics it writes on each trace. */
export const LiveEvaluatorSummary = ({evaluator}: {evaluator: Workflow}) => {
    const metrics = evaluatorOutputKeys(evaluator.data)

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
            <WorkflowTypeTag
                isEvaluator
                workflowKey={parseWorkflowKeyFromUri(evaluator.data?.uri)}
                className="self-start"
            />
            {metrics.length > 0 ? (
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Output metrics</span>
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                        {metrics.map((metric) => (
                            <li
                                key={metric}
                                className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs text-foreground"
                            >
                                {metric}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}
