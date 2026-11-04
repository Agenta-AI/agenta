import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    evaluationMetricMolecule,
    evaluationResultMolecule,
    evaluationRunQueryAtomFamily,
    evaluationRunQueryKey,
    isTerminalRunStatus,
    queryEvaluationScenariosPage,
    runHeaderAtomFamily,
    type EvaluationRunScenario,
} from "@agenta/entities/evaluationRun"
import {
    makeHydrateScenariosTransform,
    type HydrateFetchers,
    MOLECULE_BACKED_HYDRATE_FETCHERS,
} from "@agenta/entities/evaluationRun/etl"
import {projectIdAtom} from "@agenta/shared/state"
import {
    useInfiniteQuery,
    useQueryClient,
    type InfiniteData,
    type QueryClient,
} from "@tanstack/react-query"
import {getDefaultStore, useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    buildScenarioRowData,
    isTerminalScenarioStatus,
    scenarioColumnGroups,
    type ScenarioRow,
    type ScenarioRowData,
    type ScenarioSchema,
} from "./scenarioColumns"

export const SCENARIOS_PAGE_SIZE = 50
/** How often rows that have not finished are read again while the run is running. */
export const SCENARIOS_REFRESH_MS = 5000

interface ScenarioPage {
    /** The cursor this page was asked with; null for the first page. */
    cursor: string | null
    nextCursor: string | null
    rows: ScenarioRowData[]
}
type ScenarioPages = InfiniteData<ScenarioPage, string | null>

export const runScenariosQueryKey = (projectId: string, runId: string) =>
    ["evaluation-run-scenarios", projectId, runId] as const

interface PageRequest {
    projectId: string
    runId: string
    order: "ascending" | "descending"
    schema: ScenarioSchema
}

/**
 * One page of scenarios, with the values of its rows read from the entities they point at.
 *
 * The caches hold an empty answer for a scenario that had no results yet, so the results and
 * metrics of these scenarios are read again, not taken from the cache. The shared hydration step
 * hides a failed read (the values come back empty), so a failure is counted here and thrown: a
 * row with missing values from a failed request must not look like a row without values.
 */
async function loadScenarioPage(
    request: PageRequest,
    cursor: string | null,
): Promise<ScenarioPage> {
    const {projectId, runId, order, schema} = request
    const page = await queryEvaluationScenariosPage({
        projectId,
        runId,
        limit: SCENARIOS_PAGE_SIZE,
        cursor,
        order,
    })
    const scenarioIds = page.scenarios.map((scenario) => scenario.id)
    evaluationResultMolecule.actions.evictByScenarioIds({projectId, runId, scenarioIds})
    evaluationMetricMolecule.actions.evictByScenarioIds({projectId, runId, scenarioIds})

    let failed = false
    const failedTraceIds = new Set<string>()
    const watch =
        <A, R>(read: (args: A) => Promise<R>) =>
        (args: A) =>
            read(args).catch((error: unknown) => {
                failed = true
                throw error
            })
    const fetchers: HydrateFetchers = {
        fetchResults: watch(MOLECULE_BACKED_HYDRATE_FETCHERS.fetchResults),
        fetchMetrics: watch(MOLECULE_BACKED_HYDRATE_FETCHERS.fetchMetrics),
        fetchTestcases: watch(MOLECULE_BACKED_HYDRATE_FETCHERS.fetchTestcases),
        fetchTraces: async (args) => {
            const found = await MOLECULE_BACKED_HYDRATE_FETCHERS.fetchTraces(args)
            // The trace read hides its own failure. It leaves the cache without an entry for a
            // trace it could not read, and with an empty entry for a trace that does not exist yet.
            const cache = getDefaultStore().get(queryClientAtom)
            for (const traceId of args.traceIds) {
                if (found.has(traceId)) continue
                if (cache.getQueryData(["trace-entity", args.projectId, traceId]) === undefined) {
                    failedTraceIds.add(traceId)
                }
            }
            return found
        },
    }
    const hydrate = makeHydrateScenariosTransform<EvaluationRunScenario>({
        projectId,
        runId,
        fetchers,
    })
    const chunk = await hydrate({items: page.scenarios, cursor: page.nextCursor})
    if (failed) throw new Error("The values of these scenarios did not load.")
    return {
        cursor,
        nextCursor: page.nextCursor,
        rows: chunk.items.map((hydrated) =>
            buildScenarioRowData(
                hydrated,
                schema,
                hydrated.results.some(
                    (result) => result.trace_id != null && failedTraceIds.has(result.trace_id),
                ),
            ),
        ),
    }
}

/**
 * Read again the pages that hold a scenario that has not finished (as the cache last saw it), or
 * whose values failed to load. Other pages stay as they are. An online run also reads its first
 * page, where new scenarios arrive, and so does a run whose first page is still empty. When a
 * page now ends elsewhere, the pages after it no longer start in the right place: they are
 * dropped and load again on demand.
 */
async function refreshOpenPages(client: QueryClient, request: PageRequest): Promise<void> {
    const key = runScenariosQueryKey(request.projectId, request.runId)
    const current = client.getQueryData<ScenarioPages>(key)
    if (!current) return

    const needsRead = (row: ScenarioRowData) =>
        !isTerminalScenarioStatus(row.scenario.status) || row.valuesFailed
    const readsNewest = request.order === "descending"
    const stale = current.pages.filter(
        (page) =>
            page.rows.some(needsRead) ||
            (page.cursor === null && (readsNewest || page.rows.length === 0)),
    )
    if (stale.length === 0) return

    const fresh = await Promise.all(stale.map((page) => loadScenarioPage(request, page.cursor)))
    client.setQueryData<ScenarioPages>(key, (latest) => {
        if (!latest) return latest
        const pages: ScenarioPage[] = []
        const pageParams: (string | null)[] = []
        for (const [position, page] of latest.pages.entries()) {
            const next = fresh.find((candidate) => candidate.cursor === page.cursor)
            pages.push(next ?? page)
            pageParams.push(latest.pageParams[position])
            if (next && next.nextCursor !== page.nextCursor) break
        }
        return {pages, pageParams}
    })
}

/**
 * The scenarios of one run, page by page, with the values of each row. Opening the tab only reads.
 * While the run runs, rows that have not finished are read again every few seconds; pages whose
 * rows are all done are left alone. Two screens that show the same run pass `poll: false` on one
 * of them, so only one reads again.
 */
export function useRunScenarios(runId: string, {poll = true}: {poll?: boolean} = {}) {
    const projectId = useAtomValue(projectIdAtom)
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const client = useQueryClient()

    const run = runQuery.data ?? null
    const steps = run?.data?.steps
    const mappings = run?.data?.mappings
    const schema = useMemo<ScenarioSchema>(
        () => ({steps: steps ?? [], mappings: mappings ?? []}),
        [steps, mappings],
    )
    const columnGroups = useMemo(() => scenarioColumnGroups(schema), [schema])
    // An online run keeps adding scenarios, so its newest come first.
    const order: PageRequest["order"] = header?.kind === "online" ? "descending" : "ascending"

    const query = useInfiniteQuery({
        queryKey: runScenariosQueryKey(projectId ?? "", runId),
        enabled: Boolean(projectId && run),
        initialPageParam: null as string | null,
        queryFn: ({pageParam}) =>
            loadScenarioPage({projectId: projectId ?? "", runId, order, schema}, pageParam),
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        staleTime: 30_000,
    })

    const rows = useMemo<ScenarioRow[]>(
        () =>
            (query.data?.pages ?? [])
                .flatMap((page) => page.rows)
                .map((row, position) => ({...row, index: position + 1})),
        [query.data],
    )

    const live = Boolean(header) && !isTerminalRunStatus(header?.status)
    const inFlight = useRef(false)
    const readAgain = useRef(false)
    const loadMoreQueued = useRef(false)
    const latest = useRef({projectId, order, schema, live, fetchNextPage: query.fetchNextPage})
    latest.current = {projectId, order, schema, live, fetchNextPage: query.fetchNextPage}
    const [refreshFailed, setRefreshFailed] = useState(false)

    const refreshRef = useRef<(rereadRun: boolean) => Promise<void>>(async () => undefined)
    const refresh = useCallback(
        async (rereadRun: boolean) => {
            const {projectId: project, order: currentOrder, schema: currentSchema} = latest.current
            if (!project) return
            // A refresh and a load of the next page both write the page list, and the later
            // writer would drop what the other one wrote. They run one after the other.
            if (
                inFlight.current ||
                client.isFetching({queryKey: runScenariosQueryKey(project, runId)}) > 0
            ) {
                // A read that overlaps another is not lost: the last pass of a finished run
                // must not be dropped because a tick was still running.
                readAgain.current = true
                return
            }
            inFlight.current = true
            try {
                // The run page does not poll the run itself: read its status so a finished run is seen.
                if (rereadRun)
                    await client.invalidateQueries({queryKey: evaluationRunQueryKey(runId)})
                await refreshOpenPages(client, {
                    projectId: project,
                    runId,
                    order: currentOrder,
                    schema: currentSchema,
                })
                setRefreshFailed(false)
            } catch {
                // While the run runs, the next tick tries again. Once it is done, nothing does.
                setRefreshFailed(!latest.current.live)
            } finally {
                inFlight.current = false
                if (loadMoreQueued.current) {
                    loadMoreQueued.current = false
                    void latest.current.fetchNextPage()
                } else if (readAgain.current) {
                    readAgain.current = false
                    void refreshRef.current(false)
                }
            }
        },
        [client, runId],
    )

    refreshRef.current = refresh

    // A read that waited for a load of the next page runs when that load ends.
    const fetching = query.isFetching
    useEffect(() => {
        if (fetching || !readAgain.current) return
        readAgain.current = false
        void refreshRef.current(false)
    }, [fetching])

    useEffect(() => {
        if (!live || !poll) return
        const timer = setInterval(() => {
            if (!document.hidden) void refresh(true)
        }, SCENARIOS_REFRESH_MS)
        return () => clearInterval(timer)
    }, [live, poll, refresh])

    // One last read when the run finishes: its last scenarios may have finished since the last tick.
    const wasLive = useRef(false)
    useEffect(() => {
        if (!poll) return
        if (live) {
            wasLive.current = true
            return
        }
        if (!wasLive.current) return
        wasLive.current = false
        void refresh(false)
    }, [live, poll, refresh])

    const loadMore = useCallback(() => {
        if (inFlight.current) {
            loadMoreQueued.current = true
            return
        }
        void query.fetchNextPage()
    }, [query])

    return {
        rows,
        columnGroups,
        order,
        hasMore: Boolean(query.hasNextPage),
        loadMore,
        /** Read again the rows whose values did not load. */
        retryValues: () => void refresh(false),
        refreshFailed,
        retryRefresh: () => void refresh(false),
        isPending: query.isPending,
        isError: query.isError && !query.data,
        refetch: () => void query.refetch(),
        isFetchingMore: query.isFetchingNextPage,
        loadMoreError: query.isFetchNextPageError ? query.error : null,
    }
}
