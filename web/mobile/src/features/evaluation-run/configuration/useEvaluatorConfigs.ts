import {runReferencesAtomFamily} from "@agenta/entities/evaluationRun"
import {
    workflowArtifactQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

export interface EvaluatorConfig {
    /** The step key: one evaluator can appear in two steps. */
    key: string
    name: string
    description: string | null
    /** The revision version the run used; null when the run names no revision. */
    version: number | null
    /** The run names no revision, so the evaluator's latest revision is shown. */
    latest: boolean
    /** The revision to open: the run's, else the latest one once it is known. */
    revisionId: string | null
    settings: Record<string, unknown> | null
    /** The stored revision data, shown as JSON. */
    snapshot: unknown
    pending: boolean
    failed: boolean
}

/**
 * What the Evaluators section shows for one run, one entry per evaluator step. A step without a
 * revision reference shows the evaluator's latest revision and writes nothing to the run.
 */
const evaluatorConfigsAtomFamily = atomFamily((runId: string) =>
    atom<EvaluatorConfig[]>((get) =>
        (get(runReferencesAtomFamily(runId))?.evaluators ?? []).map((step) => {
            const {evaluatorId, stepKey, slug} = step
            const referencedRevisionId = step.revisionId
            const artifact = get(workflowArtifactQueryAtomFamily(evaluatorId))
            const latest = referencedRevisionId
                ? null
                : get(workflowLatestRevisionQueryAtomFamily(evaluatorId))
            const revisionId = referencedRevisionId ?? latest?.data?.id ?? null
            const revision = revisionId ? get(workflowQueryAtomFamily(revisionId)) : null
            const stored = revision?.data
            // A query that finished with nothing (a deleted revision) is a failure, not a wait.
            const settledEmpty = (query: {isPending: boolean; data?: unknown} | null) =>
                Boolean(query && !query.isPending && !query.data)
            const failed =
                artifact.isError ||
                Boolean(latest?.isError || revision?.isError) ||
                settledEmpty(latest) ||
                settledEmpty(revision)
            return {
                key: stepKey,
                name: artifact.data?.name?.trim() || slug || evaluatorId,
                description: artifact.data?.description?.trim() || null,
                version: referencedRevisionId ? (stored?.version ?? null) : null,
                latest: !referencedRevisionId,
                revisionId,
                settings: stored?.data?.parameters ?? null,
                snapshot: stored?.data ?? null,
                pending: !failed && (artifact.isPending || !stored),
                failed,
            }
        }),
    ),
)

export const useEvaluatorConfigs = (runId: string) =>
    useAtomValue(evaluatorConfigsAtomFamily(runId))
