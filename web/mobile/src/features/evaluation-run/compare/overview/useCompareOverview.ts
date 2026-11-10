import {useMemo} from "react"

import {
    compareMetricKey,
    runHeaderAtomFamily,
    runLevelMetricsQueryAtomFamily,
    runMetricCatalogAtomFamily,
    runReferencesAtomFamily,
    type RunHeader,
    type RunReferences,
} from "@agenta/entities/evaluationRun"
import {testsetQueryAtomFamily} from "@agenta/entities/testset"
import {workflowArtifactQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import type {OverviewMetric, OverviewNames} from "../../overview/useRunOverview"

/** One run of a comparison, with everything its overview column, radar series and bars need. */
export interface CompareRunOverview {
    runId: string
    /** 0 for the base run, 1 to 4 for the compared runs: picks the run's color. */
    slot: number
    header: RunHeader | null
    references: RunReferences | null
    /** The run's metrics; an id is the same in every run (`compareMetricKey`). */
    metrics: OverviewMetric[]
    metricsPending: boolean
    metricsError: Error | null
    names: OverviewNames
}

/**
 * The overview of the base run and every compared run, read in one atom: the metric reads of all
 * runs start in the same frame, so the package sends them as one request.
 */
export function useCompareOverview(runIds: readonly string[]): CompareRunOverview[] {
    const key = runIds.join(",")
    const overviewAtom = useMemo(() => {
        const ids = key.split(",").filter(Boolean)
        return atom<CompareRunOverview[]>((get) =>
            ids.map((runId, slot) => {
                const header = get(runHeaderAtomFamily(runId))
                const references = get(runReferencesAtomFamily(runId))
                const metricsQuery = get(runLevelMetricsQueryAtomFamily(runId))
                const catalog = get(runMetricCatalogAtomFamily(runId))
                const nameOf = (id: string) => get(workflowArtifactQueryAtomFamily(id)).data?.name
                const evaluators = Object.fromEntries(
                    catalog.flatMap((entry) =>
                        entry.evaluatorId ? [[entry.evaluatorId, nameOf(entry.evaluatorId)]] : [],
                    ),
                )
                const applicationId = references?.applicationId ?? null
                const revisionId = references?.revisionId ?? null
                return {
                    runId,
                    slot,
                    header,
                    references,
                    metrics: catalog.map((entry) => ({
                        ...entry,
                        id: compareMetricKey(entry),
                        evaluatorName: entry.evaluatorId
                            ? (evaluators[entry.evaluatorId] ?? entry.evaluatorSlug)
                            : null,
                    })),
                    metricsPending: metricsQuery.isPending,
                    metricsError: metricsQuery.isError ? metricsQuery.error : null,
                    names: {
                        evaluators,
                        testsets: (references?.testsets ?? []).map(
                            (testset) =>
                                get(testsetQueryAtomFamily(testset.testsetId)).data?.name ?? null,
                        ),
                        application: applicationId ? (nameOf(applicationId) ?? null) : null,
                        variant: revisionId
                            ? get(workflowMolecule.selectors.variantLabel(revisionId))
                            : null,
                    },
                }
            }),
        )
    }, [key])
    return useAtomValue(overviewAtom)
}
