import {useCallback, useEffect, useMemo, useRef} from "react"

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
import {useAtomValue} from "jotai"

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
        fetchTraces: watch(MOLECULE_BACKED_HYDRATE_FETCHERS.fetchTraces),
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
        rows: chunk.items.map((hydrated) => buildScenarioRowData(hydrated, schema)),
    }
}

/**
 * Read again the pages that hold a scenario that has not finished, or that finished since the last
 * look. Other pages stay as they are. An online run also reads its first page, where new
 * scenarios arrive. When a page now ends elsewhere, the pages after it no longer start in the
 * right place: they are dropped and load again on demand. Returns the ids still open.
 */
async function refreshOpenPages(
    client: QueryClient,
    request: PageRequest,
    previouslyOpen: ReadonlySet<string>,
): Promise<Set<string>> {
    const key = runScenariosQueryKey(request.projectId, request.runId)
    const current = client.getQueryData<ScenarioPages>(key)
    if (!current) return new Set(previouslyOpen)

    const needsRead = (row: ScenarioRowData) =>
        !isTerminalScenarioStatus(row.scenario.status) || previouslyOpen.has(row.scenario.id)
    const readsNewest = request.order === "descending"
    const stale = current.pages.filter(
        (page) => page.rows.some(needsRead) || (readsNewest && page.cursor === null),
    )
    if (stale.length === 0) return new Set()

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
    return new Set(
        fresh.flatMap((page) =>
            page.rows
                .filter((row) => !isTerminalScenarioStatus(row.scenario.status))
                .map((row) => row.scenario.id),
        ),
    )
}

/**
 * The scenarios of one run, page by page, with the values of each row. Opening the tab only reads.
 * While the run runs, rows that have not finished are read again every few seconds; pages whose
 * rows are all done are left alone.
 */
export function useRunScenarios(runId: string) {
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
    const openIds = useRef<Set<string>>(new Set())
    const inFlight = useRef(false)
    const readAgain = useRef(false)
    const latest = useRef({projectId, order, schema})
    latest.current = {projectId, order, schema}

    const refreshRef = useRef<(rereadRun: boolean) => Promise<void>>(async () => undefined)
    const refresh = useCallback(
        async (rereadRun: boolean) => {
            const {projectId: project, order: currentOrder, schema: currentSchema} = latest.current
            if (!project) return
            if (inFlight.current) {
                // A read that overlaps another is not lost: the last pass of a finished run
                // must not be dropped because a tick was still running.
                if (!rereadRun) readAgain.current = true
                return
            }
            inFlight.current = true
            try {
                // The run page does not poll the run itself: read its status so a finished run is seen.
                if (rereadRun)
                    await client.invalidateQueries({queryKey: evaluationRunQueryKey(runId)})
                openIds.current = await refreshOpenPages(
                    client,
                    {projectId: project, runId, order: currentOrder, schema: currentSchema},
                    openIds.current,
                )
            } catch {
                // The next tick tries again.
            } finally {
                inFlight.current = false
                if (readAgain.current) {
                    readAgain.current = false
                    void refreshRef.current(false)
                }
            }
        },
        [client, runId],
    )

    refreshRef.current = refresh

    useEffect(() => {
        if (!live) return
        const timer = setInterval(() => {
            if (!document.hidden) void refresh(true)
        }, SCENARIOS_REFRESH_MS)
        return () => clearInterval(timer)
    }, [live, refresh])

    // One last read when the run finishes: its last scenarios may have finished since the last tick.
    const wasLive = useRef(false)
    useEffect(() => {
        if (live) {
            wasLive.current = true
            return
        }
        if (!wasLive.current) return
        wasLive.current = false
        void refresh(false)
    }, [live, refresh])

    return {
        rows,
        columnGroups,
        order,
        hasMore: Boolean(query.hasNextPage),
        loadMore: () => void query.fetchNextPage(),
        isPending: query.isPending,
        isError: query.isError && !query.data,
        refetch: () => void query.refetch(),
        isFetchingMore: query.isFetchingNextPage,
        loadMoreError: query.isFetchNextPageError ? query.error : null,
    }
}
