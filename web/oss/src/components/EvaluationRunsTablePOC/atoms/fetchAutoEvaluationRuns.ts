import type {RunFlagsFilter} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"
import {fetchPreviewRunsShared} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/assets/previewRunsRequest"

import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"

import type {QueryWindowingPayload} from "../../../services/onlineEvaluations/api"
import type {
    PreviewEvaluationRun,
    EvaluationRunApiRow,
    EvaluationRunsWindowResult,
    EvaluationRunKind,
    PreviewRunColumnMeta,
    ConcreteEvaluationRunKind,
} from "../types"

interface PreviewEvaluationRunsResult {
    runs: PreviewEvaluationRun[]
    count: number
    windowing: QueryWindowingPayload | null
}

interface FetchPreviewRunsParams {
    projectId: string
    appId?: string | null
    searchQuery?: string | null
    references?: any[]
    flags?: RunFlagsFilter
    statuses?: string[]
    evaluationKind?: EvaluationRunKind
    windowing?: QueryWindowingPayload | null
}

interface FetchEvaluationRunsWindowParams {
    projectId: string
    appIds: string[]
    limit: number
    offset: number
    cursor?: string | null
    includePreview?: boolean
    evaluationKind: EvaluationRunKind
    previewSearchQuery?: string | null
    previewReferences?: any[]
    previewFlags?: RunFlagsFilter
    statusFilters?: string[] | null
    evaluationTypeFilters?: ConcreteEvaluationRunKind[] | null
    dateRange?: {from?: string | null; to?: string | null} | null
}

const fetchPreviewRuns = async ({
    projectId,
    appId,
    searchQuery,
    references,
    flags,
    statuses,
    evaluationKind,
    windowing,
}: FetchPreviewRunsParams): Promise<PreviewEvaluationRunsResult> => {
    const response = await fetchPreviewRunsShared({
        projectId,
        appId,
        searchQuery,
        references,
        flags,
        statuses,
        evaluationKind,
        windowing,
    })

    return {
        runs: response.runs as PreviewEvaluationRun[],
        count: response.count,
        windowing: response.windowing ?? null,
    }
}

const isPreviewRunHuman = (run: PreviewEvaluationRun): boolean => {
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    const hasHuman = steps.some((step: any) => {
        const type = step?.type ?? step?.stepType ?? step?.kind
        if (type !== "annotation") return false
        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        return origin === "human"
    })
    return hasHuman && !isPreviewRunOnline(run)
}

const isPreviewRunOnline = (run: PreviewEvaluationRun): boolean => {
    const flags = run?.flags ?? {}
    if (flags?.isLive === true || flags?.is_live === true) {
        return true
    }
    const source = typeof run?.meta?.source === "string" ? run.meta.source.toLowerCase() : null
    return source === "online_evaluation_drawer"
}

const isPreviewRunCustom = (run: PreviewEvaluationRun): boolean => {
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    const hasCustom = steps.some((step: any) => {
        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        const type = step?.type ?? step?.stepType ?? step?.kind
        if (origin === "custom" || type === "custom") return true
        return Boolean(step?.metadata?.origin === "custom")
    })
    return hasCustom && !isPreviewRunOnline(run)
}

const derivePreviewRunKind = (run: PreviewEvaluationRun): ConcreteEvaluationRunKind => {
    if (isPreviewRunOnline(run)) return "online"
    if (isPreviewRunHuman(run)) return "human"
    if (isPreviewRunCustom(run)) return "custom"
    return "auto"
}

const normalizeEvaluationKindString = (
    value: string | null | undefined,
): ConcreteEvaluationRunKind | null => {
    if (typeof value !== "string") return null
    const normalized = value.trim().toLowerCase()
    switch (normalized) {
        case "auto":
        case "human":
        case "online":
        case "custom":
            return normalized
        default:
            return null
    }
}

const normalizeString = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
}

const isNonNullable = <T>(value: T): value is NonNullable<T> =>
    value !== null && value !== undefined

const deriveSlugFromStepKey = (stepKey?: string | null) => {
    if (!stepKey) return null
    const lastSegment = stepKey.includes(".") ? stepKey.split(".").pop() : stepKey
    return normalizeString(lastSegment ?? stepKey)
}

const normalizeEvaluatorReference = (
    references: Record<string, any> | null | undefined,
    opts: {stepKey?: string | null} = {},
) => {
    if (!references || typeof references !== "object") {
        return references ?? null
    }
    const cloned: Record<string, any> = {...references}
    if (cloned.evaluator && typeof cloned.evaluator === "object") {
        const evaluator = {...cloned.evaluator}
        const id = normalizeString(evaluator.id)
        const derivedFromKey = deriveSlugFromStepKey(opts.stepKey)
        const slug =
            normalizeString(evaluator.slug) ??
            normalizeString(evaluator.key) ??
            normalizeString(cloned.evaluator_revision?.slug) ??
            normalizeString(cloned.evaluator_variant?.slug) ??
            normalizeString(evaluator.name) ??
            derivedFromKey ??
            id ??
            null
        if (id) {
            evaluator.id = id
        }
        if (slug) {
            evaluator.slug = slug
        }
        cloned.evaluator = evaluator
    }
    return cloned
}

const extractPreviewRunMeta = (run: PreviewEvaluationRun): PreviewRunColumnMeta => {
    const steps: PreviewRunColumnMeta["steps"] = Array.isArray(run?.data?.steps)
        ? run.data.steps
              .map((step: any) => {
                  const key =
                      normalizeString(step?.key) ??
                      normalizeString(step?.step) ??
                      normalizeString(step?.stepKey)
                  if (!key) return null
                  const type =
                      normalizeString(step?.type) ??
                      normalizeString(step?.stepType) ??
                      normalizeString(step?.kind)
                  const origin =
                      normalizeString(step?.origin) ??
                      normalizeString(step?.step_role) ??
                      normalizeString(step?.stepRole)
                  const references = normalizeEvaluatorReference(step?.references, {stepKey: key})
                  return {key, type, origin, references}
              })
              .filter(isNonNullable)
        : []

    const mappings: PreviewRunColumnMeta["mappings"] = Array.isArray(run?.data?.mappings)
        ? run.data.mappings
              .map((mapping: any) => {
                  const kind =
                      normalizeString(mapping?.kind) ?? normalizeString(mapping?.column?.kind)
                  const name =
                      normalizeString(mapping?.name) ?? normalizeString(mapping?.column?.name)
                  const stepKey =
                      normalizeString(mapping?.step?.key) ??
                      normalizeString(mapping?.step?.stepKey) ??
                      normalizeString(mapping?.stepKey) ??
                      normalizeString(mapping?.step?.step)
                  let path =
                      normalizeString(mapping?.step?.path) ??
                      normalizeString(mapping?.path) ??
                      normalizeString(mapping?.column?.path)
                  if (
                      path &&
                      (kind === "annotation" || kind === "evaluator") &&
                      !path.startsWith("attributes.ag.")
                  ) {
                      const trimmed = path.replace(/^\.+/, "")
                      path = `attributes.ag.${trimmed}`
                  }
                  if (!stepKey || !path) return null
                  return {kind, name, stepKey, path}
              })
              .filter(isNonNullable)
        : []

    const evaluatorDefsRaw =
        (Array.isArray((run as any)?.evaluators) && (run as any).evaluators) ||
        (Array.isArray(run?.meta?.evaluators) && run.meta.evaluators) ||
        []
    const evaluators = Array.isArray(evaluatorDefsRaw)
        ? evaluatorDefsRaw
              .map((evaluator: any) => ({
                  id: normalizeString(evaluator?.id),
                  slug: normalizeString(evaluator?.slug ?? evaluator?.key),
                  name: normalizeString(evaluator?.name) ?? normalizeString(evaluator?.label),
              }))
              .filter((item: any) => item.id || item.slug || item.name)
        : []

    return {
        steps,
        mappings,
        evaluators,
    }
}

const normalizeWindowing = (
    payload: QueryWindowingPayload | null | undefined,
): WindowingState | null => {
    if (!payload) {
        return null
    }
    return {
        next: payload.next ?? null,
        stop: payload.oldest ?? null,
        order: payload.order ?? null,
        limit: payload.limit ?? null,
    }
}

export const fetchEvaluationRunsWindow = async ({
    projectId,
    appIds,
    limit,
    offset,
    includePreview = true,
    evaluationKind,
    previewFlags,
    previewReferences,
    previewSearchQuery,
    statusFilters,
    cursor = null,
    evaluationTypeFilters,
    dateRange,
}: FetchEvaluationRunsWindowParams): Promise<EvaluationRunsWindowResult> => {
    if (!projectId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }

    const previewAppId = appIds.length === 1 ? appIds[0] : undefined
    const allowedKinds =
        evaluationKind === "all" && evaluationTypeFilters && evaluationTypeFilters.length
            ? new Set<ConcreteEvaluationRunKind>(evaluationTypeFilters)
            : null
    const normalizedKindForQuery = evaluationKind === "all" ? undefined : evaluationKind
    const windowingPayload: QueryWindowingPayload = {
        limit,
        order: "descending" as const,
        next: cursor ?? undefined,
    }
    if (dateRange?.to) {
        windowingPayload.newest = dateRange.to
    }
    if (dateRange?.from) {
        windowingPayload.oldest = dateRange.from
    }

    const previewResult = includePreview
        ? await fetchPreviewRuns({
              projectId,
              appId: previewAppId,
              searchQuery: previewSearchQuery,
              references: previewReferences,
              flags: previewFlags,
              statuses: statusFilters && statusFilters.length ? statusFilters : undefined,
              evaluationKind: normalizedKindForQuery,
              windowing: windowingPayload,
          })
        : {runs: [], count: 0, windowing: null}

    const rows: EvaluationRunApiRow[] = []

    const normalizedSearch = previewSearchQuery?.trim().toLowerCase() ?? null
    const normalizedStatusSet =
        statusFilters && statusFilters.length
            ? new Set(statusFilters.map((status) => status.toLowerCase()))
            : null

    const matchesSearch = (values: (string | null | undefined)[]): boolean => {
        if (!normalizedSearch) return true
        return values.some(
            (value) => typeof value === "string" && value.toLowerCase().includes(normalizedSearch),
        )
    }

    const matchesStatus = (statusValue: string | null | undefined): boolean => {
        if (!normalizedStatusSet) return true
        if (!statusValue) return false
        return normalizedStatusSet.has(statusValue.toLowerCase())
    }

    const allowedAppIds = appIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    const allowedAppSet =
        allowedAppIds.length > 0 ? new Set(allowedAppIds.map((id) => id.trim())) : null

    previewResult.runs.forEach((run) => {
        const metaKindRaw = ((run as any)?.meta?.evaluation_kind ??
            (run as any)?.meta?.evaluationKind ??
            (run as any)?.flags?.evaluation_kind ??
            null) as string | null
        const normalizedMetaKind = normalizeEvaluationKindString(metaKindRaw)
        const derivedKind = normalizedMetaKind ?? derivePreviewRunKind(run)

        if (evaluationKind !== "all" && derivedKind !== evaluationKind) {
            return
        }
        if (evaluationKind === "all" && allowedKinds && !allowedKinds.has(derivedKind)) {
            return
        }

        if (!normalizedMetaKind) {
            ;(run as any).meta = {
                ...(typeof (run as any).meta === "object" && (run as any).meta
                    ? (run as any).meta
                    : {}),
                evaluation_kind: derivedKind,
            }
        }
        const runId = run.id ?? null
        const metaApplication = (run as any)?.meta?.application ?? {}
        const runAppId = metaApplication?.id ?? (run as any)?.meta?.appId ?? null
        if (allowedAppSet && runAppId && !allowedAppSet.has(runAppId)) {
            return
        }
        const previewName = typeof (run as any)?.name === "string" ? (run as any).name : null
        if (!matchesSearch([runId, previewName, metaApplication?.id, metaApplication?.name])) {
            return
        }
        const previewStatus = (run as any)?.status?.value ?? (run as any)?.status ?? null
        if (!matchesStatus(previewStatus)) {
            return
        }
        rows.push({
            key: `preview::${runId ?? Math.random().toString(36).slice(2)}`,
            source: "preview",
            projectId,
            runId,
            createdAt: run.createdAt ?? null,
            status:
                (typeof (run as any)?.status === "string"
                    ? (run as any).status
                    : (run as any)?.status?.value) ?? null,
            appId: runAppId ?? null,
            preview: runId ? {id: runId} : undefined,
            previewMeta: extractPreviewRunMeta(run),
            evaluationKind: derivedKind,
        })
    })

    rows.sort((a, b) => {
        const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tsB - tsA
    })

    const totalCount =
        evaluationKind === "all" && allowedKinds
            ? rows.length
            : (previewResult.count ?? rows.length)
    const pageRows = rows
    const nextOffset = offset + pageRows.length
    const previewNextCursor = previewResult.windowing?.next ?? null
    const hasMore = Boolean(previewNextCursor)

    return {
        rows: pageRows,
        totalCount,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        nextCursor: previewNextCursor,
        nextWindowing: normalizeWindowing(previewResult.windowing),
    }
}
