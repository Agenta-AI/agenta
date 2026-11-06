import {runReferencesAtomFamily} from "@agenta/entities/evaluationRun"
import {
    parseEvaluatorKeyFromUri,
    workflowArtifactQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

/** One field of what the evaluator returns, from its outputs schema. */
export interface EvaluatorOutputMetric {
    name: string
    type: string | null
    required: boolean
}

export interface EvaluatorConfig {
    /** The step key: one evaluator can appear in two steps. */
    key: string
    evaluatorId: string
    name: string
    /** The template key in the revision URI, for example `auto_exact_match`. */
    evaluatorKey: string | null
    outputs: EvaluatorOutputMetric[]
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

/** The fields of an outputs JSON schema, in order, with their type and whether they are required. */
export const outputMetrics = (schema: unknown): EvaluatorOutputMetric[] => {
    const properties = asRecord(asRecord(schema)?.properties)
    if (!properties) return []
    const required = asRecord(schema)?.required
    const requiredNames = new Set(Array.isArray(required) ? required.map(String) : [])
    return Object.entries(properties).map(([name, field]) => {
        const type = asRecord(field)?.type
        return {
            name,
            type: typeof type === "string" ? type : Array.isArray(type) ? type.join(" | ") : null,
            required: requiredNames.has(name),
        }
    })
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
                evaluatorId,
                name: artifact.data?.name?.trim() || slug || evaluatorId,
                evaluatorKey: parseEvaluatorKeyFromUri(stored?.data?.uri) ?? null,
                outputs: outputMetrics(stored?.data?.schemas?.outputs),
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
