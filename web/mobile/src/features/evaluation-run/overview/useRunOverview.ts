import {useMemo} from "react"

import {
    runLevelMetricsQueryAtomFamily,
    runMetricCatalogAtomFamily,
    runReferencesAtomFamily,
    type RunMetricEntry,
} from "@agenta/entities/evaluationRun"
import {testsetQueryAtomFamily} from "@agenta/entities/testset"
import {workflowArtifactQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

/** A catalog entry with the evaluator's display name resolved. */
export interface OverviewMetric extends RunMetricEntry {
    /** The evaluator's name, else its slug; null for invocation metrics. */
    evaluatorName: string | null
}

export interface OverviewNames {
    evaluators: Record<string, string | null | undefined>
    testsets: (string | null)[]
    application: string | null
    variant: string | null
}

interface OverviewNameIds {
    evaluatorIds: string[]
    testsetIds: string[]
    applicationId: string | null
    revisionId: string | null
}

/**
 * The names the overview shows. The atom is rebuilt only when an id changes: the catalog and the
 * references are new arrays after every poll, and a new atom would read all the names again.
 */
export function useOverviewNames(ids: OverviewNameIds): OverviewNames {
    const {applicationId, revisionId} = ids
    const evaluatorKey = [...new Set(ids.evaluatorIds)].join(",")
    const testsetKey = ids.testsetIds.join(",")
    const namesAtom = useMemo(() => {
        const evaluatorIds = evaluatorKey ? evaluatorKey.split(",") : []
        const testsetIds = testsetKey ? testsetKey.split(",") : []
        return atom<OverviewNames>((get) => ({
            evaluators: Object.fromEntries(
                evaluatorIds.map((id) => [id, get(workflowArtifactQueryAtomFamily(id)).data?.name]),
            ),
            testsets: testsetIds.map((id) => get(testsetQueryAtomFamily(id)).data?.name ?? null),
            application: applicationId
                ? (get(workflowArtifactQueryAtomFamily(applicationId)).data?.name ?? null)
                : null,
            variant: revisionId ? get(workflowMolecule.selectors.variantLabel(revisionId)) : null,
        }))
    }, [evaluatorKey, testsetKey, applicationId, revisionId])
    return useAtomValue(namesAtom)
}

/** Everything the Overview tab of one run reads. Compare runs are a later step. */
export function useRunOverview(runId: string) {
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const metricsQuery = useAtomValue(runLevelMetricsQueryAtomFamily(runId))
    const catalog = useAtomValue(runMetricCatalogAtomFamily(runId))

    const names = useOverviewNames({
        evaluatorIds: catalog.flatMap((entry) => entry.evaluatorId ?? []),
        testsetIds: references?.testsets.map((testset) => testset.testsetId) ?? [],
        applicationId: references?.applicationId ?? null,
        revisionId: references?.revisionId ?? null,
    })

    const metrics = useMemo<OverviewMetric[]>(
        () =>
            catalog.map((entry) => ({
                ...entry,
                evaluatorName: entry.evaluatorId
                    ? (names.evaluators[entry.evaluatorId] ?? entry.evaluatorSlug)
                    : null,
            })),
        [catalog, names.evaluators],
    )

    return {
        references,
        metrics,
        metricsPending: metricsQuery.isPending,
        metricsError: metricsQuery.isError ? metricsQuery.error : null,
        names,
    }
}
