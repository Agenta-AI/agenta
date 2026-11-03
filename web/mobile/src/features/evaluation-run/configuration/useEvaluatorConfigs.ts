import {useMemo} from "react"

import type {RunReferences} from "@agenta/entities/evaluationRun"
import {
    workflowArtifactQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

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
 * What the Evaluators section shows, one entry per evaluator step. A step without a revision
 * reference shows the evaluator's latest revision and writes nothing to the run. The atom is
 * rebuilt only when an id changes.
 */
export function useEvaluatorConfigs(references: RunReferences | null): EvaluatorConfig[] {
    const steps = references?.evaluators
    const stepsKey = JSON.stringify(
        steps?.map((step) => [step.stepKey, step.evaluatorId, step.revisionId, step.slug]) ?? [],
    )

    const configsAtom = useMemo(() => {
        const parsed = JSON.parse(stepsKey) as [string, string, string | null, string | null][]
        return atom<EvaluatorConfig[]>((get) =>
            parsed.map(([key, evaluatorId, referencedRevisionId, slug]) => {
                const artifact = get(workflowArtifactQueryAtomFamily(evaluatorId))
                const latest = referencedRevisionId
                    ? null
                    : get(workflowLatestRevisionQueryAtomFamily(evaluatorId))
                const revisionId = referencedRevisionId ?? latest?.data?.id ?? null
                const revision = revisionId ? get(workflowQueryAtomFamily(revisionId)) : null
                const stored = revision?.data
                const failed =
                    artifact.isError ||
                    Boolean(latest && (latest.isError || (!latest.isPending && !latest.data))) ||
                    Boolean(revision?.isError)
                return {
                    key,
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
        )
    }, [stepsKey])
    return useAtomValue(configsAtom)
}
