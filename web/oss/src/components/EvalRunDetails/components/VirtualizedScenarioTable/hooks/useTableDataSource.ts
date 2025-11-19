import {useEffect, useMemo, useState} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {Loadable} from "jotai/vanilla/utils/loadable"
import groupBy from "lodash/groupBy"

import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {ColumnDef} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import useEvaluatorConfigs from "@/oss/lib/hooks/useEvaluatorConfigs"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {fetchEvaluatorById} from "@/oss/services/evaluators"

import {
    evaluationRunStateFamily,
    loadingStateFamily,
    runIndexFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedAtoms"
// import {scenarioMetricsMapFamily} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {runMetricsStatsCacheFamily} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {
    displayedScenarioIdsFamily,
    loadableScenarioStepFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedScenarios"
import {evaluatorFailuresMapFamily} from "../assets/atoms/evaluatorFailures"
import {buildScenarioTableData, buildScenarioTableRows} from "../assets/dataSourceBuilder"
import {buildEvaluatorNameMap} from "../assets/evaluatorNameUtils"
import {
    collectEvaluatorIdentifiers,
    collectMetricSchemasFromEvaluator,
    deriveSchemaMetricType,
    mergeEvaluatorRecords,
    pickString,
    toArray,
} from "../assets/evaluatorSchemaUtils"
import {buildAntdColumns} from "../assets/utils"

const EMPTY_SCENARIOS: any[] = []
const EMPTY_METRICS_MAP: Record<string, any[]> = {}

export const editColumnsFamily = atomFamily((runId: string) => atom<string[]>([]), deepEqual)

export const allScenariosLoadedFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const runState = get(evaluationRunStateFamily(runId))
            const loadingState = get(loadingStateFamily(runId))
            const scenarios = runState?.scenarios
            if (loadingState?.isLoadingScenarios) return false
            return Array.isArray(scenarios)
        }),
    deepEqual,
)

// Run-scoped metrics from evaluators atom family
export const metricsFromEvaluatorsFamily = atomFamily(
    (runId: string) =>
        selectAtom(
            evaluationRunStateFamily(runId),
            (state) => {
                const evs = state?.enrichedRun?.evaluators
                    ? Object.values(state.enrichedRun.evaluators)
                    : []
                if (!evs || !Array.isArray(evs)) {
                    return {}
                }
                return groupBy(
                    evs.reduce((acc: any[], ev: any) => {
                        return [
                            ...acc,
                            ...Object.entries(ev.metrics || {}).map(
                                ([metricName, metricInfo]: [string, any]) => {
                                    return {
                                        [metricName]: {
                                            metricType: metricInfo.type,
                                        },
                                        evaluatorSlug: ev.slug,
                                    }
                                },
                            ),
                        ]
                    }, []),
                    (def: any) => {
                        return def.evaluatorSlug
                    },
                )
            },
            deepEqual,
        ),
    deepEqual,
)

const firstScenarioLoadableFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const ids = get(displayedScenarioIdsFamily(runId)) || EMPTY_SCENARIOS
            if (!ids.length) {
                return {state: "hasValue", data: undefined} as Loadable<
                    UseEvaluationRunScenarioStepsFetcherResult | undefined
                >
            }
            return get(loadableScenarioStepFamily({runId, scenarioId: ids[0]}))
        }),
    deepEqual,
)

const useTableDataSource = () => {
    const runId = useRunId()
    // states
    const [editColumns, setEditColumns] = useAtom(editColumnsFamily(runId))

    // Read from the same global store that writes are going to
    const scenarioIds = useAtomValue(displayedScenarioIdsFamily(runId)) || EMPTY_SCENARIOS
    const allScenariosLoaded = useAtomValue(allScenariosLoadedFamily(runId))

    // const metricDistributions = useAtomValue(runMetricsStatsAtom)
    const runIndex = useAtomValue(runIndexFamily(runId))
    const metricsFromEvaluators =
        useAtomValue(metricsFromEvaluatorsFamily(runId)) || EMPTY_METRICS_MAP
    const metricStatsMap = useAtomValue(runMetricsStatsCacheFamily(runId)) || {}
    // temporary implementation to implement loading state for auto eval
    const firstScenarioLoadable = useAtomValue(firstScenarioLoadableFamily(runId))
    const loadableState = firstScenarioLoadable?.state
    const evaluationRunState = useAtomValue(evaluationRunStateFamily(runId))
    const runAppId =
        evaluationRunState?.enrichedRun?.appId ??
        evaluationRunState?.enrichedRun?.app_id ??
        evaluationRunState?.enrichedRun?.app?.id ??
        evaluationRunState?.enrichedRun?.application?.id ??
        null
    const rawEvaluators = evaluationRunState?.enrichedRun?.evaluators
    const runEvaluators = useMemo(
        () =>
            Array.isArray(rawEvaluators)
                ? rawEvaluators
                : rawEvaluators
                  ? Object.values(rawEvaluators)
                  : [],
        [rawEvaluators],
    )
    const revisionSlugByEvaluatorSlug = useMemo(() => {
        const map = new Map<string, string>()
        const steps = runIndex?.steps ?? {}
        Object.values(steps).forEach((meta: any) => {
            if (!meta || meta.kind !== "annotation") return
            const baseSlug = pickString(meta?.refs?.evaluator?.slug)
            const revisionSlug = pickString(meta?.refs?.evaluatorRevision?.slug)
            if (baseSlug && revisionSlug && baseSlug !== revisionSlug) {
                if (!map.has(baseSlug)) {
                    map.set(baseSlug, revisionSlug)
                }
            }
        })
        return map
    }, [runIndex])
    const evaluatorFailuresMap = useAtomValue(evaluatorFailuresMapFamily(runId))
    const {data: previewEvaluators} = useEvaluators({preview: true})
    const {data: projectEvaluators} = useEvaluators()
    const [fetchedEvaluatorsById, setFetchedEvaluatorsById] = useState<Record<string, any>>({})
    const {data: evaluatorConfigs} = useEvaluatorConfigs({appId: runAppId})
    const evaluatorConfigsForNames = useMemo(
        () =>
            (evaluatorConfigs ?? []).map((config) => ({
                ...config,
                slug: config?.id,
            })),
        [evaluatorConfigs],
    )
    const evaluatorNameBySlug = useMemo(
        () =>
            buildEvaluatorNameMap(
                runEvaluators,
                previewEvaluators,
                projectEvaluators,
                evaluatorConfigsForNames,
                Object.values(fetchedEvaluatorsById),
            ),
        [
            runEvaluators,
            previewEvaluators,
            projectEvaluators,
            evaluatorConfigsForNames,
            fetchedEvaluatorsById,
        ],
    )

    const catalogEvaluatorsByIdentifier = useMemo(() => {
        const map = new Map<string, any>()
        const register = (entry: any) => {
            if (!entry) return
            collectEvaluatorIdentifiers(entry).forEach((identifier) => {
                if (!map.has(identifier)) {
                    map.set(identifier, entry)
                }
            })
        }
        toArray(previewEvaluators).forEach(register)
        toArray(projectEvaluators).forEach(register)
        Object.values(fetchedEvaluatorsById || {}).forEach(register)
        return map
    }, [previewEvaluators, projectEvaluators, fetchedEvaluatorsById])

    const resolvedMetricsFromEvaluators = useMemo(() => {
        const result: Record<string, any[]> = {}
        const appendDefinition = (
            slug: string | undefined,
            metricName: string | undefined,
            metricType?: string | string[],
        ) => {
            if (!slug) return
            const name = metricName?.trim()
            if (!name) return

            const list = (result[slug] ||= [])
            const existing = list.find((definition: Record<string, any>) =>
                Object.prototype.hasOwnProperty.call(definition, name),
            )
            if (existing) {
                existing[name] = {
                    ...existing[name],
                    metricType: existing[name]?.metricType ?? metricType,
                }
                return
            }
            list.push({
                [name]: {metricType},
            })
        }

        const registerEvaluator = (entry: any) => {
            if (!entry || typeof entry !== "object") return
            const slug = pickString(entry.slug)
            if (!slug) return
            const schemas = collectMetricSchemasFromEvaluator(entry)
            schemas.forEach(({name, schema}) => {
                appendDefinition(slug, name, deriveSchemaMetricType(schema))
            })
        }

        runEvaluators.forEach((evaluator: any) => {
            const identifiers = collectEvaluatorIdentifiers(evaluator)
            let catalogMatch: any
            for (const identifier of identifiers) {
                const matched = catalogEvaluatorsByIdentifier.get(identifier)
                if (matched) {
                    catalogMatch = matched
                    break
                }
            }
            const merged = mergeEvaluatorRecords(evaluator, catalogMatch)
            registerEvaluator(merged)
        })

        Object.entries(metricsFromEvaluators || {}).forEach(([slug, definitions]) => {
            const entries = Array.isArray(definitions) ? definitions : [definitions]
            entries.forEach((definition) => {
                if (!definition || typeof definition !== "object") return
                Object.entries(definition).forEach(([metricName, meta]) => {
                    if (metricName === "evaluatorSlug") return
                    appendDefinition(slug, metricName, (meta as any)?.metricType)
                })
            })
        })

        return result
    }, [
        catalogEvaluatorsByIdentifier,
        metricsFromEvaluators,
        runEvaluators,
        revisionSlugByEvaluatorSlug,
    ])

    const evaluatorIdsFromRunIndex = useMemo(() => {
        const ids = new Set<string>()
        const steps = runIndex?.steps ?? {}
        Object.values(steps).forEach((meta: any) => {
            const id =
                typeof meta?.refs?.evaluator?.id === "string" ? meta.refs.evaluator.id : undefined
            if (id) ids.add(id)
        })
        return ids
    }, [runIndex])

    useEffect(() => {
        const knownIds = new Set<string>()
        ;[
            ...(runEvaluators || []),
            ...(previewEvaluators || []),
            ...(projectEvaluators || []),
            ...(Object.values(fetchedEvaluatorsById) || []),
        ].forEach((ev: any) => {
            const id = typeof ev?.id === "string" ? ev.id : undefined
            if (id) knownIds.add(id)
        })

        const missingIds = Array.from(evaluatorIdsFromRunIndex).filter((id) => !knownIds.has(id))
        if (!missingIds.length) return

        let cancelled = false
        ;(async () => {
            const results = await Promise.allSettled(
                missingIds.map(async (id) => {
                    try {
                        const evaluator = await fetchEvaluatorById(id)
                        return {id, evaluator}
                    } catch (error) {
                        console.warn(
                            "[useTableDataSource] Failed to fetch evaluator by id",
                            JSON.stringify({id, error: (error as Error)?.message}),
                        )
                        return {id, evaluator: null}
                    }
                }),
            )
            if (cancelled) return
            setFetchedEvaluatorsById((prev) => {
                const next = {...prev}
                results.forEach((result) => {
                    if (result.status !== "fulfilled") return
                    const {id, evaluator} = result.value
                    if (evaluator && !next[id]) {
                        next[id] = evaluator
                    }
                })
                return next
            })
        })()

        return () => {
            cancelled = true
        }
    }, [
        evaluatorIdsFromRunIndex,
        runEvaluators,
        previewEvaluators,
        projectEvaluators,
        fetchedEvaluatorsById,
    ])

    const scenarioMetaById = useMemo(() => {
        const map = new Map<string, {timestamp?: string; createdAt?: string}>()
        const scenarios = evaluationRunState?.scenarios || []
        scenarios.forEach((sc: any) => {
            const identifier = sc?.id || sc?._id
            if (!identifier) return
            map.set(identifier, {
                timestamp: sc?.timestamp || sc?.createdAt || sc?.created_at,
                createdAt: sc?.createdAt || sc?.created_at,
            })
        })
        return map
    }, [evaluationRunState?.scenarios])

    const isLoadingSteps = useMemo(() => {
        if (!scenarioIds || scenarioIds.length === 0) return false
        return loadableState === "loading" || !allScenariosLoaded
    }, [scenarioIds, loadableState, allScenariosLoaded])

    const rows = useMemo(() => {
        return buildScenarioTableRows({
            scenarioIds,
            allScenariosLoaded,
            runId,
            scenarioMetaById,
        })
    }, [scenarioIds, allScenariosLoaded, scenarioMetaById, runId])

    // New alternative data source built via shared helper
    const builtColumns: ColumnDef[] = useMemo(
        () =>
            buildScenarioTableData({
                runIndex,
                runId,
                metricsFromEvaluators: resolvedMetricsFromEvaluators,
                metrics: metricStatsMap,
                evaluators: runEvaluators,
                evaluatorNameBySlug,
                revisionSlugByEvaluatorSlug,
            }),
        [
            runIndex,
            runId,
            resolvedMetricsFromEvaluators,
            metricStatsMap,
            runEvaluators,
            evaluatorNameBySlug,
            revisionSlugByEvaluatorSlug,
        ],
    )

    // Build Ant Design columns and make them resizable
    const antColumns = useMemo(() => {
        return buildAntdColumns(builtColumns, runId, {evaluatorFailuresMap})
    }, [builtColumns, runId, evaluatorFailuresMap])

    const visibleColumns = useMemo(
        () => filterColumns(antColumns, editColumns),
        [antColumns, editColumns],
    )

    const totalColumnWidth = useMemo(() => {
        const calc = (cols: any[]): number =>
            cols.reduce((sum, col) => {
                if (!col) return sum
                if (col?.children && col?.children.length) {
                    return sum + calc(col.children)
                }
                return sum + (col?.width ?? col?.minWidth ?? 100)
            }, 0)
        return calc(visibleColumns)
    }, [visibleColumns])

    return {
        rawColumns: antColumns,
        antColumns: visibleColumns,
        rows,
        totalColumnWidth,
        isLoadingSteps,
        editColumns,
        setEditColumns,
    }
}

export default useTableDataSource
