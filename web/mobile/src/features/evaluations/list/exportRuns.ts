import {
    buildCsv,
    buildRunStatsMap,
    deriveEvaluationKind,
    flattenQueryConditions,
    queryLiveQueryRevisions,
    queryRunLevelMetrics,
    runListExportHeaders,
    runListExportRow,
    type EvaluationRun,
    type LiveQueryRevision,
    type RunListColumns,
} from "@agenta/entities/evaluationRun"
import {userByIdFamily} from "@agenta/entities/shared"
import {testsetMolecule} from "@agenta/entities/testset"
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {downloadCsv} from "@agenta/ui/list-table"
import type {createStore} from "jotai"

import {queryConditionLines} from "./queryConditionLines"
import {readRunReferences} from "./runReferences"

type Store = ReturnType<typeof createStore>

/** The query a live run watches, as its cell reads: "Trace Type is invocation; Sampling: 10%". */
const queryText = (revision: LiveQueryRevision | undefined): string | null => {
    if (!revision) return null
    const lines = queryConditionLines(flattenQueryConditions(revision.data?.filtering)).map(
        (line) => `${line.field} ${line.operator} ${line.value}`,
    )
    const rate = revision.data?.windowing?.rate
    if (typeof rate === "number")
        lines.push(`Sampling: ${Math.round(rate <= 1 ? rate * 100 : rate)}%`)
    return lines.length > 0 ? lines.join("; ") : "No filters"
}

const trimmed = (value: string | null | undefined) => value?.trim() || null

/**
 * Saves the runs as a CSV file with the columns on screen, as the old list's Export CSV does.
 * The metrics (and the queries, when the Query column shows) of every run come in one request
 * each, so rows that never scrolled into view export their numbers too. Names come from what the
 * list already loaded; a name that has not loaded writes its id.
 *
 * Loaded on the first click: the list does not carry it.
 */
export const exportRuns = async ({
    store,
    projectId,
    runs,
    plan,
    evaluatorNames,
}: {
    store: Store
    projectId: string
    runs: readonly EvaluationRun[]
    plan: RunListColumns
    evaluatorNames: Record<string, string>
}) => {
    const runIds = runs.map((run) => run.id)
    const withMetrics = plan.evaluators.length > 0 || plan.invocation.length > 0
    const queryRevisionIds = plan.references.includes("query")
        ? [
              ...new Set(
                  runs
                      .map((run) => readRunReferences(run).queryRevisionId)
                      .filter((id): id is string => Boolean(id)),
              ),
          ]
        : []
    const [metrics, queryRevisions] = await Promise.all([
        withMetrics ? queryRunLevelMetrics({projectId, runIds}) : [],
        queryLiveQueryRevisions({projectId, revisionIds: queryRevisionIds}),
    ])
    const apps = store.get(appWorkflowsListQueryStateAtom).data

    const rows = runs.map((run) => {
        const refs = readRunReferences(run)
        const app = refs.applicationId
            ? apps.find((entry) => entry.id === refs.applicationId)
            : undefined
        const testset = refs.testsetId
            ? store.get(testsetMolecule.selectors.data(refs.testsetId))
            : null
        const author = store.get(userByIdFamily(run.created_by_id))
        const stats = withMetrics
            ? buildRunStatsMap(
                  run,
                  metrics.filter((metric) => metric.run_id === run.id),
                  // A live run shows its latest window, in the list and in the file.
                  deriveEvaluationKind(run) === "online" ? "latest" : "static",
              )
            : null
        return runListExportRow(run, plan, {
            stats,
            names: {
                testset: refs.testsetId ? (trimmed(testset?.name) ?? refs.testsetId) : null,
                application: refs.applicationId
                    ? (trimmed(app?.name) ?? trimmed(app?.slug) ?? refs.applicationId)
                    : null,
                query: refs.queryRevisionId
                    ? (queryText(queryRevisions.find((rev) => rev.id === refs.queryRevisionId)) ??
                      refs.queryRevisionId)
                    : null,
                createdBy:
                    trimmed(author?.username) ?? trimmed(author?.name) ?? trimmed(author?.email),
            },
        })
    })

    downloadCsv("evaluations.csv", buildCsv(runListExportHeaders(plan, evaluatorNames), rows))
}
