import type {Key} from "react"

import {atom} from "jotai"
import {atomFamily, atomWithStorage, loadable, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {getEvaluatorMetricBlueprintAtom} from "@/oss/components/References/atoms/metricBlueprint"
import {getUniquePartOfId} from "@/oss/lib/helpers/utils"
import type {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import {RunFlagsFilter} from "@/oss/lib/hooks/usePreviewEvaluations"
import type {Variant} from "@/oss/lib/Types"
import {fetchVariants as fetchAppVariants} from "@/oss/services/api"
import {appsQueryAtom} from "@/oss/state/app"
import {evaluatorsQueryAtomFamily} from "@/oss/state/evaluators"
import {queriesQueryAtomFamily} from "@/oss/state/queries"

import {fromFilteringPayload} from "../../pages/evaluations/onlineEvaluation/assets/helpers"
import type {ConcreteEvaluationRunKind, EvaluationRunKind, EvaluationRunTableRow} from "../types"
import {summarizeQueryFilters} from "../utils/querySummary"
import {buildReferencePayload} from "../utils/referencePayload"

import {
    evaluationRunsTableContextAtom,
    evaluationRunsScopeIdAtom,
    evaluationRunsTableFetchEnabledAtom,
} from "./context"
import {previewRunSummaryAtomFamily} from "./runSummaries"
import {
    evaluationRunsMetaVersionAtom,
    evaluationRunsTableMetaAtom,
    evaluationRunsDatasetStore,
} from "./tableStore"
import type {EvaluationRunsTableMeta} from "./tableStore"

export {
    evaluationRunsTableComponentSliceAtom,
    evaluationRunsTableContextAtom,
    evaluationRunsTableContextSetterAtom,
    evaluationRunsMetaContextSliceAtom,
    evaluationRunsProjectIdAtom,
    evaluationRunsScopeIdAtom,
    evaluationRunsColumnVisibilityContextAtom,
    evaluationRunsFiltersContextAtom,
    evaluationRunsDeleteContextAtom,
    computeContextSignature,
} from "./context"

const DEFAULT_TABLE_PAGE_SIZE = 15

export const evaluationRunsTableResetAtom = atom<(() => void) | null>(null)
export const evaluationRunsTablePageSizeAtom = atom(DEFAULT_TABLE_PAGE_SIZE)

export const evaluationRunsRowsAtom = atom<EvaluationRunTableRow[]>((get) => {
    const pageSize = get(evaluationRunsTablePageSizeAtom)
    const scopeId = get(evaluationRunsScopeIdAtom)
    return get(evaluationRunsDatasetStore.atoms.rowsAtom({scopeId, pageSize}))
})

const metaArraysEqual = (a: string[], b: string[]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
}

const flagsEqual = (a?: RunFlagsFilter, b?: RunFlagsFilter) => {
    if (!a && !b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => a[key as keyof RunFlagsFilter] === b[key as keyof RunFlagsFilter])
}

const EVALUATION_TYPE_VALUES: ConcreteEvaluationRunKind[] = ["auto", "human", "online", "custom"]

const normalizeEvaluationTypeList = (
    values: (string | ConcreteEvaluationRunKind)[],
): ConcreteEvaluationRunKind[] => {
    const set = new Set<ConcreteEvaluationRunKind>()
    values.forEach((value) => {
        const normalized = String(value).trim().toLowerCase()
        if (EVALUATION_TYPE_VALUES.includes(normalized as ConcreteEvaluationRunKind)) {
            set.add(normalized as ConcreteEvaluationRunKind)
        }
    })
    return EVALUATION_TYPE_VALUES.filter((value) => set.has(value))
}

const metasEqual = (a: EvaluationRunsTableMeta, b: EvaluationRunsTableMeta) =>
    a.projectId === b.projectId &&
    metaArraysEqual(a.appIds, b.appIds) &&
    a.includePreview === b.includePreview &&
    a.evaluationKind === b.evaluationKind &&
    flagsEqual(a.previewFlags, b.previewFlags) &&
    JSON.stringify(a.previewReferences ?? null) === JSON.stringify(b.previewReferences ?? null) &&
    (a.previewSearchQuery ?? null) === (b.previewSearchQuery ?? null) &&
    JSON.stringify(a.statusFilters ?? null) === JSON.stringify(b.statusFilters ?? null) &&
    JSON.stringify(a.referenceFilters ?? null) === JSON.stringify(b.referenceFilters ?? null) &&
    JSON.stringify(a.evaluationTypeFilters ?? null) ===
        JSON.stringify(b.evaluationTypeFilters ?? null) &&
    JSON.stringify(a.dateRange ?? null) === JSON.stringify(b.dateRange ?? null)

export const evaluationRunsMetaUpdaterAtom = atom(
    null,
    (get, set, updater: (prev: EvaluationRunsTableMeta) => EvaluationRunsTableMeta) => {
        const before = get(evaluationRunsTableMetaAtom)
        const beforeVersion = get(evaluationRunsMetaVersionAtom)
        set(evaluationRunsTableMetaAtom, (prev: EvaluationRunsTableMeta) => updater(prev))
        const after = get(evaluationRunsTableMetaAtom)
        const afterVersion = get(evaluationRunsMetaVersionAtom)
        const changed = beforeVersion !== afterVersion || !metasEqual(before, after)
        if (changed) {
            const reset = get(evaluationRunsTableResetAtom)
            reset?.()
        }
    },
)

const searchInputStateAtom = atom<string | null>(null)
let searchInputDebounce: ReturnType<typeof setTimeout> | null = null

export const evaluationRunsSearchInputAtom = atom(
    (get) => {
        const state = get(searchInputStateAtom)
        if (state !== null) return state
        const meta = get(evaluationRunsTableMetaAtom)
        return meta.previewSearchQuery ?? ""
    },
    (_get, set, value: string) => {
        set(searchInputStateAtom, value)

        if (searchInputDebounce) {
            clearTimeout(searchInputDebounce)
        }

        searchInputDebounce = setTimeout(() => {
            const sanitized = value.trim()
            const next = sanitized.length ? sanitized : undefined

            set(evaluationRunsMetaUpdaterAtom, (prev) => {
                if ((prev.previewSearchQuery ?? undefined) === next) {
                    return prev
                }
                return {
                    ...prev,
                    previewSearchQuery: next,
                }
            })
        }, 300)
    },
)

export const evaluationRunsStatusFiltersAtom = atom(
    (get) => get(evaluationRunsTableMetaAtom).statusFilters ?? [],
    (_get, set, values: string[]) => {
        const normalized = values.map((value) => String(value).toLowerCase()).sort()
        set(evaluationRunsMetaUpdaterAtom, (prev) => {
            const prevNormalized = [...(prev.statusFilters ?? [])]
                .map((value) => value.toLowerCase())
                .sort()
            const isSame =
                prevNormalized.length === normalized.length &&
                prevNormalized.every((value, index) => value === normalized[index])
            if (isSame) {
                return prev
            }
            return {
                ...prev,
                statusFilters: normalized.length ? normalized : null,
            }
        })
    },
)

export const evaluationRunsTypeFiltersAtom = atom(
    (get) => get(evaluationRunsTableMetaAtom).evaluationTypeFilters ?? [],
    (_get, set, values: ConcreteEvaluationRunKind[]) => {
        const normalized = normalizeEvaluationTypeList(values)
        set(evaluationRunsMetaUpdaterAtom, (prev) => {
            const prevValues = prev.evaluationTypeFilters ?? []
            const isSame =
                prevValues.length === normalized.length &&
                prevValues.every((value, index) => value === normalized[index])
            if (isSame) {
                return prev
            }
            return {
                ...prev,
                evaluationTypeFilters: normalized.length ? normalized : null,
            }
        })
    },
)

export const evaluationRunsDateRangeAtom = atom(
    (get) => get(evaluationRunsTableMetaAtom).dateRange ?? null,
    (_get, set, range: {from?: string | null; to?: string | null} | null) => {
        set(evaluationRunsMetaUpdaterAtom, (prev) => {
            const nextRange = range && (range.from || range.to) ? range : null
            if (
                (prev.dateRange?.from ?? null) === (nextRange?.from ?? null) &&
                (prev.dateRange?.to ?? null) === (nextRange?.to ?? null)
            ) {
                return prev
            }
            return {...prev, dateRange: nextRange}
        })
    },
)

export const evaluationRunsReferenceFiltersAtom = atom(
    (get) => get(evaluationRunsTableMetaAtom).referenceFilters ?? null,
    (_get, set, {key, values}: {key: string; values: string[]}) => {
        const normalized = values.map((value) => value.trim()).filter(Boolean)
        set(evaluationRunsMetaUpdaterAtom, (prev) => {
            const prevFilters = prev.referenceFilters ?? {}
            const nextFilters: Record<string, string[]> = {...prevFilters}
            if (normalized.length) {
                nextFilters[key] = normalized
            } else {
                delete nextFilters[key]
            }
            const hasEntries = Object.keys(nextFilters).length > 0
            const referenceFilters = hasEntries ? nextFilters : null
            if (
                JSON.stringify(prev.referenceFilters ?? null) ===
                JSON.stringify(referenceFilters ?? null)
            ) {
                return prev
            }
            return {
                ...prev,
                referenceFilters,
                previewReferences: buildReferencePayload(referenceFilters),
            }
        })
    },
)

export const evaluationRunsResetFiltersAtom = atom(null, (get, set) => {
    const context = get(evaluationRunsTableContextAtom)
    const targetFlags = context.derivedPreviewFlags ?? undefined
    const targetFlagsKey = JSON.stringify(targetFlags ?? null)
    set(evaluationRunsMetaUpdaterAtom, (prev) => {
        const prevFlagsKey = JSON.stringify(prev.previewFlags ?? null)
        const hasStatuses = Boolean(prev.statusFilters && prev.statusFilters.length)
        const hasReferences = Boolean(
            prev.referenceFilters && Object.keys(prev.referenceFilters).length,
        )
        const hasEvaluationTypes = Boolean(prev.evaluationTypeFilters?.length)
        const hasDateRange = Boolean(prev.dateRange?.from || prev.dateRange?.to)
        if (
            !hasStatuses &&
            !hasReferences &&
            !hasEvaluationTypes &&
            !hasDateRange &&
            prevFlagsKey === targetFlagsKey
        ) {
            return prev
        }
        return {
            ...prev,
            statusFilters: null,
            previewFlags: context.derivedPreviewFlags,
            referenceFilters: null,
            previewReferences: buildReferencePayload(null),
            evaluationTypeFilters: null,
            dateRange: null,
        }
    })
})

const evaluationRunsSelectionSourceAtom = atom(
    (get) => {
        const scopeId = get(evaluationRunsScopeIdAtom)
        return get(evaluationRunsDatasetStore.atoms.selectionAtom({scopeId}))
    },
    (get, set, next: Key[] | ((prev: Key[]) => Key[])) => {
        const scopeId = get(evaluationRunsScopeIdAtom)
        const selectionAtom = evaluationRunsDatasetStore.atoms.selectionAtom({scopeId})
        const prev = get(selectionAtom)
        const resolved = typeof next === "function" ? (next as (prev: Key[]) => Key[])(prev) : next
        set(selectionAtom, resolved)
    },
)

export const evaluationRunsSelectedRowKeysAtom = atom(
    (get) => {
        const rows = get(evaluationRunsRowsAtom)
        const rawKeys = get(evaluationRunsSelectionSourceAtom)
        return rawKeys.filter((key) => rows.some((row) => !row.__isSkeleton && row.key === key))
    },
    (get, set, next: Key[] | ((prev: Key[]) => Key[])) => {
        const rows = get(evaluationRunsRowsAtom)
        const prev = get(evaluationRunsSelectionSourceAtom)
        const resolved = typeof next === "function" ? (next as (prev: Key[]) => Key[])(prev) : next
        const filtered = resolved.filter((key) =>
            rows.some((row) => !row.__isSkeleton && row.key === key),
        )
        set(evaluationRunsSelectionSourceAtom, filtered)
    },
)

export const evaluationRunsSelectedRowsAtom = atom((get) => {
    const rows = get(evaluationRunsRowsAtom)
    const selectedKeys = get(evaluationRunsSelectedRowKeysAtom)
    if (!selectedKeys.length) return []
    return rows.filter((row) => selectedKeys.includes(row.key))
})

export const evaluationRunsSelectedPreviewRunIdsAtom = atom((get) => {
    const rows = get(evaluationRunsSelectedRowsAtom)
    return rows
        .map((row) => row.preview?.id ?? row.runId ?? null)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
})

export const evaluationRunsSelectedLabelsAtom = atom((get) => {
    const rows = get(evaluationRunsSelectedRowsAtom)
    if (!rows.length) return ""
    return rows
        .map((row) => {
            const runId = row.preview?.id ?? row.runId
            const projectId = row.projectId
            // Try to get the name from the run summary cache
            if (projectId && runId) {
                try {
                    const summaryAtom = previewRunSummaryAtomFamily({projectId, runId})
                    const summaryResult = get(summaryAtom) as any
                    const name = summaryResult?.data?.name ?? summaryResult?.name
                    if (name && typeof name === "string" && name.trim().length > 0) {
                        return name
                    }
                } catch {
                    // Fall through to fallback
                }
            }
            // Fallback: try row.name, legacy.name, or show shortened ID
            const fallbackName =
                (row as any)?.name ??
                (row.legacy as any)?.name ??
                (runId ? getUniquePartOfId(runId) : null) ??
                row.key
            return fallbackName
        })
        .filter((label): label is string => typeof label === "string" && label.length > 0)
        .join(" | ")
})

export const evaluationRunsHasSelectionAtom = atom(
    (get) => get(evaluationRunsSelectedRowsAtom).length > 0,
)

export const evaluationRunsSelectionSnapshotAtom = atom((get) => ({
    rows: get(evaluationRunsSelectedRowsAtom),
    previewRunIds: get(evaluationRunsSelectedPreviewRunIdsAtom),
    labels: get(evaluationRunsSelectedLabelsAtom),
    hasSelection: get(evaluationRunsHasSelectionAtom),
}))

export const evaluationRunsDeleteModalOpenAtom = atom(false)

export const evaluationRunsTableHeaderStateAtom = atom((get) => {
    const context = get(evaluationRunsTableContextAtom)
    const createSupported = context.createSupported
    const createEnabled = createSupported && Boolean(context.projectId)
    const createTooltip = createSupported
        ? createEnabled
            ? null
            : "Select a project to create evaluations"
        : `Creation not yet available for ${context.evaluationKind} runs`
    return {
        createEnabled,
        createTooltip,
        evaluationKind: context.evaluationKind,
        defaultCreateType: context.createEvaluationType,
        scope: context.scope,
    }
})

const CREATE_TYPE_STORAGE_KEY = "evaluation-runs:create-type"

export const evaluationRunsCreateModalOpenAtom = atom(false)
export const evaluationRunsCreateTypePreferenceAtom = atomWithStorage<ConcreteEvaluationRunKind>(
    CREATE_TYPE_STORAGE_KEY,
    "auto",
)
export const evaluationRunsCreateSelectedTypeAtom = atom<ConcreteEvaluationRunKind>("auto")

interface EvaluationRunsFiltersSummary {
    statusFilters: string[]
    evaluatorFilters: string[]
    queryFilters: string[]
    appFilters: string[]
    variantFilters: string[]
    testsetFilters: string[]
    evaluationTypeFilters: ConcreteEvaluationRunKind[]
    dateRange: {from?: string | null; to?: string | null} | null
    mergedFlags: RunFlagsFilter
    filtersCount: number
    filtersActive: boolean
    isAutoOrHuman: boolean
    evaluationKind: EvaluationRunKind
    referenceFilters: Record<string, string[]>
    lockedReferenceFilters: Record<ReferenceFilterKey, string[]>
}

export const evaluationRunsFiltersSummaryAtom = atom<EvaluationRunsFiltersSummary>((get) => {
    const meta = get(evaluationRunsTableMetaAtom)
    const context = get(evaluationRunsTableContextAtom)

    const statusFilters = meta.statusFilters ?? []
    const referenceFilters = meta.referenceFilters ?? {}
    const evaluatorFilters = referenceFilters?.evaluator ?? []
    const queryFilters = referenceFilters?.query ?? []
    const appFilters = referenceFilters?.app ?? []
    const variantFilters = referenceFilters?.variant ?? []
    const testsetFilters = referenceFilters?.testset ?? []

    const mergedFlags: RunFlagsFilter = {}

    Object.entries(context.derivedPreviewFlags ?? {}).forEach(([key, value]) => {
        if (typeof value === "boolean") {
            mergedFlags[key as keyof RunFlagsFilter] = value
        }
    })
    Object.entries(meta.previewFlags ?? {}).forEach(([key, value]) => {
        if (typeof value === "boolean") {
            mergedFlags[key as keyof RunFlagsFilter] = value
        }
    })

    const lockedReferenceFilters: Record<ReferenceFilterKey, string[]> = {
        testset: [],
        evaluator: [],
        app: [],
        variant: [],
        query: [],
    }

    const lockedAppIds =
        context.scope === "app"
            ? context.effectiveAppIds
            : context.activeAppId
              ? [context.activeAppId]
              : []

    const normalizedLockedAppIds = lockedAppIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
    )

    lockedReferenceFilters.app = Array.from(new Set(normalizedLockedAppIds))

    const evaluationTypeFilters =
        meta.evaluationTypeFilters && meta.evaluationTypeFilters.length
            ? meta.evaluationTypeFilters
            : context.evaluationKind !== "all"
              ? [context.evaluationKind]
              : []
    const dateRange = meta.dateRange ?? null

    const referenceCount = Object.entries(referenceFilters ?? {}).reduce(
        (acc, [, list]) => acc + (Array.isArray(list) ? list.length : 0),
        0,
    )

    const filtersCount =
        statusFilters.length +
        referenceCount +
        evaluationTypeFilters.length +
        (dateRange?.from || dateRange?.to ? 1 : 0)
    const filtersActive = filtersCount > 0

    const summary: EvaluationRunsFiltersSummary = {
        statusFilters,
        evaluatorFilters,
        queryFilters,
        appFilters,
        variantFilters,
        testsetFilters,
        evaluationTypeFilters,
        mergedFlags,
        filtersCount,
        filtersActive,
        isAutoOrHuman: context.isAutoOrHuman,
        evaluationKind: context.evaluationKind,
        referenceFilters: referenceFilters ?? {},
        lockedReferenceFilters,
        dateRange,
    }
    return summary
})

export type ReferenceFilterKey = "testset" | "evaluator" | "app" | "variant" | "query"
interface QueryFilterOption {
    value: string
    label: string
    summary: string | null
    id: string | null
    slug: string | null
}

export interface FiltersDraftState {
    statusFilters: string[]
    referenceFilters: Record<ReferenceFilterKey, string[]>
    evaluationTypes: ConcreteEvaluationRunKind[]
    dateRange: {from?: string | null; to?: string | null} | null
}

const createDraftFromSummary = (summary: EvaluationRunsFiltersSummary): FiltersDraftState => ({
    statusFilters: [...summary.statusFilters],
    referenceFilters: {
        testset: [...summary.testsetFilters],
        evaluator: [...summary.evaluatorFilters],
        app: [...summary.appFilters],
        variant: [...summary.variantFilters],
        query: [...summary.queryFilters],
    },
    evaluationTypes: [...summary.evaluationTypeFilters],
    dateRange: summary.dateRange ? {...summary.dateRange} : null,
})

const filtersDraftStateAtom = atom<FiltersDraftState | null>(null)

export const evaluationRunsFiltersDraftAtom = atom(
    (get) => get(filtersDraftStateAtom),
    (
        get,
        set,
        update:
            | FiltersDraftState
            | null
            | ((prev: FiltersDraftState | null) => FiltersDraftState | null),
    ) => {
        const prev = get(filtersDraftStateAtom)
        const next = typeof update === "function" ? update(prev) : update
        set(filtersDraftStateAtom, next)
    },
)

export const evaluationRunsFiltersDraftInitializeAtom = atom(null, (get, set) => {
    const summary = get(evaluationRunsFiltersSummaryAtom)
    set(filtersDraftStateAtom, createDraftFromSummary(summary))
})

export const evaluationRunsFiltersDraftClearAtom = atom(null, (_get, set) => {
    set(filtersDraftStateAtom, null)
})

export const evaluationRunsActiveFiltersAtom = atom((get) => {
    const draft = get(filtersDraftStateAtom)
    if (draft) {
        return draft
    }
    const summary = get(evaluationRunsFiltersSummaryAtom)
    return createDraftFromSummary(summary)
})

const formatVariantLabel = (id: string, name?: string | null) => {
    if (name && name.trim().length > 0) {
        return name.trim()
    }
    return `Variant ${getUniquePartOfId(id)}`
}

export const evaluationRunsFilterOptionsAtom = atom((get) => {
    const context = get(evaluationRunsTableContextAtom)
    const isActive = get(evaluationRunsTableFetchEnabledAtom)
    const blueprintAtom = getEvaluatorMetricBlueprintAtom(context.scopeId)
    const evaluatorBlueprint = get(blueprintAtom)

    const blueprintOptions = evaluatorBlueprint
        .map((group) => {
            const slug = group.columns[0]?.evaluatorRef?.slug ?? group.id
            if (!slug) return null
            const label = group.label || slug
            return {label, value: slug}
        })
        .filter((option, index, self): option is {label: string; value: string} => {
            if (!option) return false
            return self.findIndex((candidate) => candidate?.value === option.value) === index
        })

    const evaluatorQueries =
        isActive && context.projectId
            ? get(
                  evaluatorsQueryAtomFamily({
                      projectId: context.projectId,
                      preview: true,
                      queriesKey: JSON.stringify(
                          context.evaluationKind === "human" ? {is_human: true} : null,
                      ),
                  }),
              )
            : null

    const evaluatorData =
        isActive && Array.isArray(evaluatorQueries?.data)
            ? (evaluatorQueries?.data as EvaluatorPreviewDto[])
            : []
    const evaluatorLoading = Boolean(
        isActive &&
            (evaluatorQueries?.isLoading ||
                evaluatorQueries?.isPending ||
                evaluatorQueries?.isFetching),
    )

    const evaluatorOptions =
        evaluatorData.length > 0
            ? evaluatorData
                  .map((item) => {
                      const id =
                          (typeof item.id === "string" && item.id.trim()) ||
                          (typeof (item as any).key === "string" && (item as any).key.trim()) ||
                          null
                      const slug = (typeof item.slug === "string" && item.slug.trim()) || null
                      const value = id || slug
                      if (!value) return null
                      const label =
                          (typeof item.name === "string" && item.name.trim()) ||
                          slug ||
                          value ||
                          "Evaluator"
                      return {label, value, slug: slug || undefined}
                  })
                  .filter(
                      (
                          option,
                          index,
                          self,
                      ): option is {label: string; value: string; slug?: string} => {
                          if (!option) return false
                          return (
                              self.findIndex((candidate) => candidate?.value === option.value) ===
                              index
                          )
                      },
                  )
            : blueprintOptions

    const appsQuery = get(appsQueryAtom)
    const appOptions =
        Array.isArray(appsQuery?.data) && appsQuery.data.length
            ? appsQuery.data
                  .map((app) => ({
                      value: app.app_id,
                      label: app.app_name ?? app.app_id,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label))
            : []
    const appsLoading = Boolean(
        appsQuery?.isLoading || appsQuery?.isFetching || appsQuery?.isPending,
    )

    return {
        evaluatorOptions,
        evaluatorLoading,
        appOptions,
        appsLoading,
    }
})

const appVariantsQueryAtomFamily = atomFamily(
    (appId: string) =>
        atomWithQuery<Variant[]>((get) => ({
            queryKey: ["evaluation-runs", "app-variants", appId],
            enabled: Boolean(appId),
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            queryFn: async () => {
                if (!appId) return []
                return fetchAppVariants(appId, false)
            },
        })),
    (a, b) => a === b,
)

export const evaluationRunsVariantOptionsAtom = atom((get) => {
    const draftFilters = get(filtersDraftStateAtom)
    const summary = get(evaluationRunsFiltersSummaryAtom)
    const referenceFilters = draftFilters
        ? draftFilters.referenceFilters
        : {
              evaluator: summary.evaluatorFilters,
              app: summary.appFilters,
              variant: summary.variantFilters,
              query: summary.queryFilters,
          }
    const context = get(evaluationRunsTableContextAtom)
    const selectedApps =
        referenceFilters.app.length > 0
            ? referenceFilters.app
            : context.activeAppId
              ? [context.activeAppId]
              : []

    if (!selectedApps.length) {
        return {
            options: [],
            enabled: false,
            isLoading: false,
        }
    }

    const loadables = selectedApps.map((appId) => get(loadable(appVariantsQueryAtomFamily(appId))))
    const isLoading = loadables.some((result) => result.state === "loading")

    const variants = loadables.flatMap((result) =>
        result.state === "hasData" && Array.isArray(result.data?.data) ? result.data.data : [],
    )

    const seen = new Set<string>()
    const options = variants
        .map((variant) => {
            const id = variant.variantId || (variant as any).id || null
            if (!id) return null
            const label =
                (variant.variantName && variant.variantName.trim()) ||
                (variant.name && (variant.name as string).trim()) ||
                null
            return {value: id, label: formatVariantLabel(id, label)}
        })
        .filter((option): option is {value: string; label: string} => {
            if (!option || !option.value || !option.label) {
                return false
            }
            if (seen.has(option.value)) {
                return false
            }
            seen.add(option.value)
            return true
        })
        .sort((a, b) => a.label.localeCompare(b.label))

    return {
        options,
        enabled: true,
        isLoading,
    }
})

const QUERIES_PARAMS_ENABLED = {
    payload: {include_archived: false},
    enabled: true,
} as const

const QUERIES_PARAMS_DISABLED = {
    payload: {include_archived: false},
    enabled: false,
} as const

export const evaluationRunsQueryOptionsAtom = atom((get) => {
    const context = get(evaluationRunsTableContextAtom)
    const shouldLoadQueries =
        context.evaluationKind === "online" || context.evaluationKind === "all"
    if (!shouldLoadQueries) {
        return {
            options: [],
            isLoading: false,
            enabled: false,
        }
    }

    const queryAtom = context.projectId
        ? queriesQueryAtomFamily(QUERIES_PARAMS_ENABLED)
        : queriesQueryAtomFamily(QUERIES_PARAMS_DISABLED)

    const queriesResult = get(loadable(queryAtom))
    const isLoading = queriesResult.state === "loading"
    const queries =
        queriesResult.state === "hasData" && Array.isArray(queriesResult.data?.data?.queries)
            ? (queriesResult.data?.data?.queries ?? [])
            : []

    const seen = new Set<string>()
    const options = queries
        .map<QueryFilterOption | null>((query) => {
            const value = query.slug ?? query.id
            if (!value) return null
            const label =
                (query.name && query.name.trim()) ||
                (query.slug && query.slug.trim()) ||
                `Query ${getUniquePartOfId(query.id)}`
            const filters = fromFilteringPayload(
                (query.meta?.filtering ?? query.meta?.filters) as any,
            )
            const summary = summarizeQueryFilters(filters)
            return {
                value,
                label,
                summary: summary ?? null,
                id: query.id ?? null,
                slug: query.slug ?? null,
            }
        })
        .filter((option): option is QueryFilterOption => {
            if (!option || !option.value) {
                return false
            }
            if (seen.has(option.value)) {
                return false
            }
            seen.add(option.value)
            return true
        })
        .sort((a, b) => a.label.localeCompare(b.label))

    return {
        options,
        isLoading,
        enabled: true,
    }
})

export const evaluationRunsFiltersButtonStateAtom = selectAtom(
    evaluationRunsFiltersSummaryAtom,
    (summary) => {
        const buttonType = summary.filtersActive ? "primary" : "default"
        const filterCount = summary.filtersCount
        return {buttonType, filterCount}
    },
    (a, b) => a.buttonType === b.buttonType && a.filterCount === b.filterCount,
)
