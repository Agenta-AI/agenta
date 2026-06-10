/* eslint-disable @typescript-eslint/no-explicit-any -- relocated runs-table parity data layer (WP-4i); reads dynamic backend-shaped run payloads, logic unchanged */
import type {WindowingState} from "@agenta/ui/table"

import {deriveEvaluationKind} from "../../../core"
import {hasResolvableSubject, isSubjectRun} from "../../../etl"
import {fetchPreviewRunsShared} from "../../../hooks"
import type {RunFlagsFilter} from "../../../hooks"
import type {QueryWindowingPayload} from "../../evalRunInjection"
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
    evaluationTypes?: ConcreteEvaluationRunKind[] | null
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
    /**
     * Over-fetch successive server pages until `limit` *subject* runs are
     * collected (or the stream is exhausted / a safety cap is hit). For the
     * fixed-size Overview summary (no infinite scroll): a single server page can
     * filter down to few/zero subject runs even when more exist deeper, which
     * would falsely read as "this workflow has never been evaluated". The full
     * page leaves this off — infinite scroll fills lazily on scroll.
     */
    fillToLimit?: boolean
}

// Over-fetch tuning (only used when `fillToLimit` + a subject filter are active).
const FILL_MAX_SERVER_PAGES = 8
const FILL_MIN_SERVER_PAGE = 25

const fetchPreviewRuns = async ({
    projectId,
    appId,
    searchQuery,
    references,
    flags,
    statuses,
    windowing,
    evaluationTypes,
}: FetchPreviewRunsParams): Promise<PreviewEvaluationRunsResult> => {
    const response = await fetchPreviewRunsShared({
        projectId,
        appId,
        searchQuery,
        references,
        flags,
        statuses,
        evaluationTypes,
        windowing,
    })

    return {
        runs: response.runs as PreviewEvaluationRun[],
        count: response.count,
        windowing: response.windowing ?? null,
    }
}

/**
 * Derive the evaluation kind for a preview run.
 * Uses the centralized utility from evaluationKind.ts
 */
const derivePreviewRunKind = (run: PreviewEvaluationRun): ConcreteEvaluationRunKind => {
    return deriveEvaluationKind(run) as ConcreteEvaluationRunKind
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
                  const outputType =
                      normalizeString(mapping?.outputType) ??
                      normalizeString(mapping?.output_type) ??
                      normalizeString(mapping?.column?.outputType) ??
                      normalizeString(mapping?.column?.output_type) ??
                      normalizeString(mapping?.column?.type)
                  if (!stepKey || !path) return null
                  return {kind, name, stepKey, path, outputType}
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
                  slug: normalizeString(evaluator?.slug),
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
    fillToLimit = false,
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
    const evaluationTypesPayload =
        evaluationKind === "all" && allowedKinds && allowedKinds.size
            ? Array.from(allowedKinds)
            : null
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

    const allowedAppIds = appIds
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    const allowedAppSet = allowedAppIds.length > 0 ? new Set(allowedAppIds) : null

    // Run-list SUBJECT predicate (feature F): when scoped to a workflow, keep
    // runs that *evaluated this workflow* — runs where the scoped id is the
    // run's `application`/invocation reference (the evaluated subject) — and
    // drop runs where it merely appears as a grader (`evaluator` reference).
    //
    // This replaces the prior `meta.application.id` heuristic, which is
    // unreliable: a null `meta.application` silently bypassed the guard, which
    // is how grader runs leaked onto an evaluator's Evaluations tab. The run's
    // `data.steps` are the structural source of truth. We fall back to the
    // `meta` heuristic only when a run carries no resolvable subject reference.
    //
    // `subjectScanned`/`subjectMatched` feed the hit-ratio meter: a low rolling
    // pass-ratio means the scoped workflow is graded far more than it's
    // evaluated — the signal that the backend role-aware reference filter (v2)
    // is warranted. (The FE already sends the role via the payload's dict key;
    // v2 is the backend honoring it. See evaluations/utils.py query_run_references.)
    let subjectScanned = 0
    let subjectMatched = 0

    const processRun = (run: PreviewEvaluationRun) => {
        // Derive kind from run.data.steps - this is the reliable source of truth
        // Do NOT rely on meta.evaluation_kind as it's flaky and unreliable
        const derivedKind = derivePreviewRunKind(run)

        if (evaluationKind !== "all" && derivedKind !== evaluationKind) {
            return
        }
        if (evaluationKind === "all" && allowedKinds && !allowedKinds.has(derivedKind)) {
            return
        }

        // Always set the derived kind in meta for consistency
        ;(run as any).meta = {
            ...(typeof (run as any).meta === "object" && (run as any).meta
                ? (run as any).meta
                : {}),
            evaluation_kind: derivedKind,
        }
        const runId = run.id ?? null
        const metaApplication = (run as any)?.meta?.application ?? {}
        const runAppId = metaApplication?.id ?? (run as any)?.meta?.appId ?? null
        const previewMeta = extractPreviewRunMeta(run)

        if (allowedAppSet) {
            subjectScanned += 1
            const steps = previewMeta.steps
            const passesSubject = hasResolvableSubject(steps)
                ? // Structural: the scoped workflow is the run's evaluated subject.
                  allowedAppIds.some((id) => isSubjectRun(steps, id))
                : // Fallback for runs with no resolvable subject reference:
                  // keep the prior `meta.application.id` behaviour rather than
                  // dropping a run we can't classify structurally.
                  !runAppId || allowedAppSet.has(runAppId)
            if (!passesSubject) {
                return
            }
            subjectMatched += 1
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
            previewMeta,
            evaluationKind: derivedKind,
        })
    }

    // Over-fetch loop. The fixed-size summary (`fillToLimit`) can filter a single
    // server page down to few/zero subject runs even when more exist deeper —
    // which would falsely read as "this workflow has never been evaluated". When
    // filling, pull successive server pages (advancing the cursor) until we have
    // `limit` subject runs, the stream is exhausted, or the safety cap is hit.
    // The full page leaves this off (single page) — its infinite scroll fills
    // lazily on scroll, so changing its pagination here isn't needed.
    const wantFill = Boolean(fillToLimit) && Boolean(allowedAppSet)
    const serverPageLimit = wantFill ? Math.max(limit, FILL_MIN_SERVER_PAGE) : limit
    const maxPages = wantFill ? FILL_MAX_SERVER_PAGES : 1

    let currentCursor: string | undefined = cursor ?? undefined
    let firstPageCount: number | null = null
    let lastWindowing: QueryWindowingPayload | null = null
    let pagesFetched = 0

    while (pagesFetched < maxPages) {
        pagesFetched += 1

        const windowingPayload: QueryWindowingPayload = {
            limit: serverPageLimit,
            order: "descending" as const,
            next: currentCursor,
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
                  evaluationTypes: evaluationTypesPayload,
                  windowing: windowingPayload,
              })
            : {runs: [], count: 0, windowing: null}

        if (firstPageCount === null) {
            firstPageCount = previewResult.count ?? null
        }
        lastWindowing = previewResult.windowing
        previewResult.runs.forEach(processRun)

        currentCursor = previewResult.windowing?.next ?? undefined
        if (!wantFill || rows.length >= limit || !currentCursor) {
            break
        }
    }

    rows.sort((a, b) => {
        const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tsB - tsA
    })

    // The fixed-size summary shows at most `limit` (latest N subject runs); the
    // last over-fetched server page may carry a few extra past the limit.
    const pageRows = wantFill ? rows.slice(0, limit) : rows
    const totalCount =
        evaluationKind === "all" && allowedKinds ? pageRows.length : (firstPageCount ?? rows.length)
    const nextOffset = offset + pageRows.length
    // The summary doesn't paginate (infinite scroll off), so it never advertises
    // "more"; the full page advertises the page's server cursor as before.
    const previewNextCursor = lastWindowing?.next ?? null
    const hasMore = wantFill ? false : Boolean(previewNextCursor)

    return {
        rows: pageRows,
        totalCount,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        nextCursor: previewNextCursor,
        nextWindowing: normalizeWindowing(lastWindowing),
        subjectFilterStats: allowedAppSet
            ? {scanned: subjectScanned, matched: subjectMatched}
            : undefined,
    }
}
