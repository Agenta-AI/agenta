import {useMemo} from "react"

import {
    isTextOutputMetric,
    type RunListColumns,
    type RunListEvaluatorGroup,
} from "@agenta/entities/evaluationRun"
import {workflowArtifactQueryAtomFamily, workflowQueryAtomFamily} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

interface EvaluatorInfo {
    /** The evaluator's name, else its slug. */
    name: string
    /** The output schema of the evaluator revision the runs used, when it has loaded. */
    outputs: unknown
}

/**
 * The evaluator columns as the old list shows them: each group with the evaluator's name, and
 * without the metrics the evaluator types as text (a comment does not aggregate). The names and
 * the schemas come in one batched request each; the atom is rebuilt only when a group changes.
 */
export const useEvaluatorColumns = (
    plan: RunListColumns,
): {plan: RunListColumns; names: Record<string, string>} => {
    const spec = JSON.stringify(
        plan.evaluators.map((group) => [group.id, group.evaluatorId, group.evaluatorRevisionId]),
    )
    const infoAtom = useMemo(() => {
        const entries = JSON.parse(spec) as [string, string | null, string | null][]
        return atom<Record<string, EvaluatorInfo>>((get) =>
            Object.fromEntries(
                entries.map(([id, evaluatorId, revisionId]) => {
                    const name = evaluatorId
                        ? get(workflowArtifactQueryAtomFamily(evaluatorId)).data?.name?.trim()
                        : null
                    const revision = revisionId
                        ? get(workflowQueryAtomFamily(revisionId)).data
                        : null
                    return [id, {name: name || id, outputs: revision?.data?.schemas?.outputs}]
                }),
            ),
        )
    }, [spec])
    const info = useAtomValue(infoAtom)

    return useMemo(() => {
        const keep = (group: RunListEvaluatorGroup): RunListEvaluatorGroup => ({
            ...group,
            columns: group.columns.filter(
                (column) => !isTextOutputMetric(info[group.id]?.outputs, column.metricKey),
            ),
        })
        return {
            plan: {
                ...plan,
                evaluators: plan.evaluators.map(keep).filter((group) => group.columns.length > 0),
            },
            names: Object.fromEntries(Object.entries(info).map(([id, entry]) => [id, entry.name])),
        }
    }, [plan, info])
}
