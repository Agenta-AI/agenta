import {useMemo} from "react"

import {
    runLevelMetricsQueryAtomFamily,
    runMetricCatalogAtomFamily,
    runQueryConfigQueryAtomFamily,
    runReferencesAtomFamily,
    type RunMetricEntry,
} from "@agenta/entities/evaluationRun"
import {testsetQueryAtomFamily, testsetRevisionHeaderAtomFamily} from "@agenta/entities/testset"
import {workflowArtifactQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {metricDisplayLabel} from "../metricLabel"

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
    /** The stored versions, for a run whose references carry none (human runs). */
    revisionVersion?: number | null
    testsetVersions?: (number | null)[]
}

interface OverviewNameIds {
    evaluatorIds: string[]
    testsetIds: string[]
    /** The test set revisions whose version the run does not name; "" for the others. */
    testsetRevisionIds?: string[]
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
    const testsetRevisionKey = (ids.testsetRevisionIds ?? []).join(",")
    const namesAtom = useMemo(() => {
        const evaluatorIds = evaluatorKey ? evaluatorKey.split(",") : []
        const testsetIds = testsetKey ? testsetKey.split(",") : []
        const testsetRevisionIds = testsetRevisionKey ? testsetRevisionKey.split(",") : []
        return atom<OverviewNames>((get) => ({
            evaluators: Object.fromEntries(
                evaluatorIds.map((id) => [id, get(workflowArtifactQueryAtomFamily(id)).data?.name]),
            ),
            testsets: testsetIds.map((id) => get(testsetQueryAtomFamily(id)).data?.name ?? null),
            application: applicationId
                ? (get(workflowArtifactQueryAtomFamily(applicationId)).data?.name ?? null)
                : null,
            variant: revisionId ? get(workflowMolecule.selectors.variantLabel(revisionId)) : null,
            revisionVersion: revisionId
                ? (get(workflowMolecule.selectors.data(revisionId))?.version ?? null)
                : null,
            testsetVersions: testsetRevisionIds.map((id) =>
                id
                    ? (get(testsetRevisionHeaderAtomFamily(id)).data?.revisionVersion ?? null)
                    : null,
            ),
        }))
    }, [evaluatorKey, testsetKey, testsetRevisionKey, applicationId, revisionId])
    return useAtomValue(namesAtom)
}

const NO_QUERY = {queryId: "", revisionId: null}

/** Everything the Overview tab of one run reads. Compare runs are a later step. */
export function useRunOverview(runId: string) {
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const metricsQuery = useAtomValue(runLevelMetricsQueryAtomFamily(runId))
    const catalog = useAtomValue(runMetricCatalogAtomFamily(runId))
    // A live run's trace query, at the revision the run stored; a run without one reads nothing.
    const queryConfig = useAtomValue(
        runQueryConfigQueryAtomFamily(references?.queries[0] ?? NO_QUERY),
    )

    const names = useOverviewNames({
        evaluatorIds: catalog.flatMap((entry) => entry.evaluatorId ?? []),
        testsetIds: references?.testsets.map((testset) => testset.testsetId) ?? [],
        testsetRevisionIds:
            references?.testsets.map((testset) =>
                testset.version === null ? (testset.revisionId ?? "") : "",
            ) ?? [],
        applicationId: references?.applicationId ?? null,
        revisionId: references?.revisionId ?? null,
    })

    const metrics = useMemo<OverviewMetric[]>(
        () =>
            catalog.map((entry) => {
                const evaluatorName = entry.evaluatorId
                    ? (names.evaluators[entry.evaluatorId] ?? entry.evaluatorSlug)
                    : null
                return {
                    ...entry,
                    label: metricDisplayLabel(entry.label, evaluatorName),
                    evaluatorName,
                }
            }),
        [catalog, names.evaluators],
    )

    return {
        references,
        metrics,
        metricsPending: metricsQuery.isPending,
        metricsError: metricsQuery.isError ? metricsQuery.error : null,
        names,
        query: queryConfig.isPending ? undefined : (queryConfig.data ?? null),
        onRetryMetrics: () => void metricsQuery.refetch(),
    }
}
