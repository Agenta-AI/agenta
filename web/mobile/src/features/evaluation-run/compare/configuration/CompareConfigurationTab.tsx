import {CompareConfigColumn} from "./CompareConfigColumn"

/**
 * The Configuration tab while runs are compared, as in the old app: one column per run, base run
 * first, each with its summary, test set, application with its prompt, and evaluators. Each
 * compared run marks what differs from the base run.
 */
export const CompareConfigurationTab = ({
    projectId,
    runId,
    compareIds,
}: {
    projectId: string
    runId: string
    compareIds: readonly string[]
}) => (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        {[runId, ...compareIds].map((id, slot) => (
            <CompareConfigColumn
                key={id}
                projectId={projectId}
                runId={id}
                baseRunId={runId}
                slot={slot}
            />
        ))}
    </div>
)
