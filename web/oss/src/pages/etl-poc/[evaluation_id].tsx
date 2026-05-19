/**
 * ETL PoC test page.
 *
 * Standalone debug route that mounts the production InfiniteVirtualTable with
 * an entities-package–backed hydrate strategy. Reuses the existing scenarios
 * paginated store (`evaluationPreviewTableStore`) so the only delta vs the
 * production scenarios view is:
 *
 *   1. Bulk hydrate on every loaded page — one call each for
 *      results / metrics / testcases / traces via molecule prefetch actions.
 *      Production today fetches per-cell; this page fetches per-page.
 *   2. Cells read directly from molecule caches (no per-cell network).
 *   3. Columns are derived from `runSchema.steps + mappings` via
 *      `resolveMappings()` from `@agenta/entities/evaluationRun/etl`.
 *      Same code path the headless PoC uses.
 *   4. v1 client-side predicate filter (`makeRowPredicateFilter`) with a
 *      simple dropdown UI.
 *   5. Scope-change eviction handler — calls `evictByRunId` +
 *      `clearCacheByPrefix` + atom family clear on `runId` change.
 *
 * URL: /etl-poc/<runId>?project_id=<projectId>
 *
 * Not linked from anywhere in the UI. Visit directly with a valid runId.
 */

import {useMemo} from "react"

import {useRouter} from "next/router"

import EtlPocScenariosTable from "@/oss/components/EtlPocScenarios"

const EtlPocPage = () => {
    const router = useRouter()
    const evaluationIdParam = router.query?.evaluation_id
    const projectIdParam = router.query?.project_id

    const runId = useMemo(() => {
        const value = Array.isArray(evaluationIdParam) ? evaluationIdParam[0] : evaluationIdParam
        return value ?? null
    }, [evaluationIdParam])
    const projectId = useMemo(() => {
        const value = Array.isArray(projectIdParam) ? projectIdParam[0] : projectIdParam
        return value ?? null
    }, [projectIdParam])

    if (!router.isReady) {
        return <div className="p-4 text-sm text-zinc-500">Waiting for router…</div>
    }

    if (!runId) {
        return (
            <div className="p-4 text-sm">
                Provide an <code>evaluation_id</code> in the URL: <br />
                <code>/etl-poc/&lt;runId&gt;?project_id=&lt;projectId&gt;</code>
            </div>
        )
    }

    return (
        <div
            className="w-full h-full overflow-hidden flex flex-col"
            data-testid="etl-poc-scenarios-page"
        >
            <EtlPocScenariosTable runId={runId} projectId={projectId} />
        </div>
    )
}

export default EtlPocPage
