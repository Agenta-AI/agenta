/**
 * Evaluation runs list API.
 *
 * One page of runs for a runs screen: server filters (name, statuses, app,
 * date window), the client filters the server cannot apply (kind, subject app),
 * and a fill loop so a filtered page is full when more matching runs exist.
 *
 * Endpoint: `POST /evaluations/runs/query`
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import type {QueryClient} from "@tanstack/react-query"
import {z} from "zod"

import {deriveEvaluationKind, type EvaluationRunKind} from "../core/runKind"
import {evaluationRunSchema, type EvaluationRun} from "../core/schema"
import {hasResolvableSubject, isSubjectRun} from "../etl/runReferenceFilter"

/** Smallest server page when a client filter is active. */
const MIN_FILTERED_SERVER_PAGE = 25
/** Most server pages one call reads while filling a filtered page. */
const MAX_SERVER_PAGES = 8
/** A cached run younger than this is not replaced by a list row. */
const FRESH_RUN_MS = 60_000

const evaluationRunsPageResponseSchema = z.object({
    count: z.number(),
    runs: z.array(evaluationRunSchema),
    windowing: z.object({next: z.string().nullable().optional()}).nullable().optional(),
})

export interface EvaluationRunsPageParams {
    projectId: string
    limit: number
    /** Cursor from the previous page. */
    cursor?: string | null
    /** Case-insensitive match on the run name. */
    name?: string
    statuses?: string[]
    /** Keep runs that evaluated this app. Runs where the app only grades are dropped. */
    appId?: string
    kind?: EvaluationRunKind
    /** Run flags the server matches, for example `{has_traces: false}`. */
    flags?: Record<string, boolean>
    /** ISO timestamps. */
    createdAfter?: string
    createdBefore?: string
}

export interface EvaluationRunsPage {
    runs: EvaluationRun[]
    /** Pass as `cursor` for the next page. `null` when there are no more runs. */
    nextCursor: string | null
}

async function fetchServerPage(
    params: EvaluationRunsPageParams,
    serverLimit: number,
    next: string | null,
) {
    const {projectId, name, statuses, appId, flags, createdAfter, createdBefore} = params

    const run: Record<string, unknown> = {}
    if (name) run.name = name
    if (statuses && statuses.length > 0) run.statuses = statuses
    if (appId) run.references = [{application: {id: appId}}]
    if (flags && Object.keys(flags).length > 0) run.flags = flags

    const body = {
        ...(Object.keys(run).length > 0 ? {run} : {}),
        windowing: {
            limit: serverLimit,
            order: "descending",
            ...(next ? {next} : {}),
            ...(createdAfter ? {oldest: createdAfter} : {}),
            ...(createdBefore ? {newest: createdBefore} : {}),
        },
    }

    const response = await axios.post(`${getAgentaApiUrl()}/evaluations/runs/query`, body, {
        params: {project_id: projectId},
    })
    const page = evaluationRunsPageResponseSchema.parse(response.data)
    return {runs: page.runs, next: page.windowing?.next || null}
}

/**
 * Fetch one page of evaluation runs, newest first.
 *
 * Without `kind` and `appId` this is one server request of `limit` rows. With
 * either, it reads server pages until `limit` runs match, the runs end, or
 * eight pages were read. The cursor then points after the last returned run,
 * so the next call does not skip matching runs.
 *
 * Throws when a request fails.
 */
export async function queryEvaluationRunsPage(
    params: EvaluationRunsPageParams,
): Promise<EvaluationRunsPage> {
    const {limit, appId, kind} = params
    const clientFiltered = Boolean(kind || appId)

    if (!clientFiltered) {
        const page = await fetchServerPage(params, limit, params.cursor ?? null)
        return {runs: page.runs, nextCursor: page.next}
    }

    const keep = (run: EvaluationRun): boolean => {
        if (kind && deriveEvaluationKind(run) !== kind) return false
        if (appId) {
            const steps = run.data?.steps
            if (hasResolvableSubject(steps) && !isSubjectRun(steps, appId)) return false
        }
        return true
    }

    const serverLimit = Math.max(limit, MIN_FILTERED_SERVER_PAGE)
    const matches: EvaluationRun[] = []
    let next = params.cursor ?? null

    for (let pageIndex = 0; pageIndex < MAX_SERVER_PAGES; pageIndex++) {
        const page = await fetchServerPage(params, serverLimit, next)
        for (const [index, run] of page.runs.entries()) {
            if (!keep(run)) continue
            matches.push(run)
            if (matches.length === limit) {
                // The API cursor is the id of the last row of a page (`id < next`), so the
                // id of the last returned run resumes right after it.
                const pageConsumed = index === page.runs.length - 1
                return {runs: matches, nextCursor: pageConsumed ? page.next : run.id}
            }
        }
        next = page.next
        if (!next) return {runs: matches, nextCursor: null}
    }
    return {runs: matches, nextCursor: next}
}

export interface EvaluationRunsListKeyParams {
    name?: string
    statuses?: string[]
    appId?: string
    kind?: EvaluationRunKind
    flags?: Record<string, boolean>
    createdAfter?: string
    createdBefore?: string
}

/** Query key for a runs list. Status order does not change the key. */
export function evaluationRunsListQueryKey(
    projectId: string,
    params: EvaluationRunsListKeyParams = {},
): readonly unknown[] {
    const {name, statuses, appId, kind, flags, createdAfter, createdBefore} = params
    return [
        "evaluation-runs",
        "list",
        projectId,
        {
            name,
            statuses: statuses ? [...statuses].sort() : undefined,
            appId,
            kind,
            flags,
            createdAfter,
            createdBefore,
        },
    ]
}

/** Query key of one run in the cache that the run details read. */
export const evaluationRunQueryKey = (runId: string) => ["evaluationRun", runId] as const

/**
 * Put listed runs in the run cache that the run details read, so a row click
 * opens the run without a second request. A run cached in the last 60 seconds
 * is kept. Pass the rows of the current page only.
 */
export function seedEvaluationRunCache(
    queryClient: QueryClient,
    runs: readonly EvaluationRun[],
): void {
    const now = Date.now()
    for (const run of runs) {
        const queryKey = evaluationRunQueryKey(run.id)
        const state = queryClient.getQueryState(queryKey)
        if (state?.data && now - state.dataUpdatedAt < FRESH_RUN_MS) continue
        queryClient.setQueryData(queryKey, run)
    }
}
