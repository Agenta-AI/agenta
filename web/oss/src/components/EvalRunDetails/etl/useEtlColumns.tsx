/**
 * useEtlColumns
 *
 * Derives the scenario table's **schema columns** (testset / application /
 * evaluator(s) / metrics / other) from a run's schema (steps + mappings)
 * via `groupRunColumns`, and adapts them into nested-header IVT columns
 * whose leaf cells mount `EtlResolvedCell`.
 *
 * This replaces the backend-metadata column path (`usePreviewColumns`)
 * for the *rendered* schema columns. The meta columns (index / status,
 * timestamp, action) and the column-visibility trigger stay on the
 * production path — they are not schema-derived. The two are stitched
 * together in `Table.tsx`.
 *
 * "other"-kind columns are kept (the PoC dropped them) so the visible
 * column set matches the backend-metadata path.
 */

import {useMemo} from "react"

import {groupRunColumns, type ColumnGroup, type RunSchema} from "@agenta/entities/evaluationRun/etl"
import {Tooltip} from "antd"
import type {ColumnsType} from "antd/es/table"

import type {EvaluationTableColumnsResult} from "../atoms/table"
import type {PreviewTableRow} from "../atoms/tableRows"

import EtlResolvedCell, {EtlSkeletonCell} from "./cells/EtlResolvedCell"
import {buildColumnValueTypeResolver} from "./columnValueTypes"
import EtlColumnHeader from "./EtlColumnHeader"

const WIDTH_BY_KIND: Record<ColumnGroup["kind"], number> = {
    testset: 220,
    application: 400,
    evaluator: 180,
    metrics: 140,
    other: 180,
}

export interface UseEtlColumnsArgs {
    projectId: string | null
    runId: string | null
    schema: RunSchema | null
    /**
     * Backend-metadata column result. Used to look up each leaf's
     * `metricType` so string-typed evaluator outputs are hidden from the
     * table (they remain in the focus drawer, which reads `columnResult`
     * directly). When omitted, no type-based filtering is applied.
     */
    columnResult?: EvaluationTableColumnsResult | null
}

/**
 * Schema columns for the scenario table, as nested-header IVT columns.
 * Empty until the run schema is available.
 */
export const useEtlColumns = ({
    projectId,
    runId,
    schema,
    columnResult,
}: UseEtlColumnsArgs): ColumnsType<PreviewTableRow> => {
    return useMemo<ColumnsType<PreviewTableRow>>(() => {
        if (!schema || !projectId || !runId) return []

        // "metrics"-kind columns are intentionally skipped here. The
        // scenario table's "Metrics" group is the *static* invocation
        // metrics (cost / duration / tokens) injected by the
        // backend-metadata column path — not run-mapping-derived — so that
        // group is kept on the production path in `Table.tsx` and rendered
        // by the existing metric cell. Emitting an ETL metrics group too
        // would duplicate it.
        //
        // String-typed evaluator outputs are also hidden from the table:
        // their per-scenario values resolve through the metric layer as
        // `{type: "string", count: …}` stats blobs that have no useful
        // per-row scalar representation. They remain visible in the focus
        // drawer (FocusDrawer reads `columnResult` directly, bypassing
        // this hook).
        //
        // The filter is restricted to `evaluator` leaves because
        // `buildColumnValueTypeResolver` falls back to a column-name-only
        // lookup — without the kind guard, a same-named testset /
        // application / other column would inherit the evaluator's
        // `metricType` and be incorrectly dropped.
        const resolveValueType = buildColumnValueTypeResolver(columnResult ?? undefined)
        const grouped = groupRunColumns(schema.steps, schema.mappings)
            .filter((g) => g.group.kind !== "metrics")
            .map((g) => ({
                ...g,
                columns: g.columns.filter((leaf) => {
                    if (leaf.kind !== "evaluator") return true
                    return (
                        resolveValueType({
                            groupKind: leaf.kind,
                            groupSlug: leaf.groupSlug,
                            columnName: leaf.name,
                        }) !== "string"
                    )
                }),
            }))
            .filter((g) => g.columns.length > 0)

        return grouped.map((g) => {
            const children = g.columns.map((leaf) => {
                const key = `${g.group.key}::${leaf.name}`
                return {
                    key,
                    columnVisibilityLabel: leaf.name,
                    title: (
                        <Tooltip title={leaf.name} placement="top">
                            <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left">
                                {leaf.name}
                            </span>
                        </Tooltip>
                    ),
                    width: WIDTH_BY_KIND[leaf.kind],
                    minWidth: WIDTH_BY_KIND[leaf.kind],
                    ellipsis: true,
                    align: "left" as const,
                    render: (_: unknown, record: PreviewTableRow) => {
                        // antd's virtual table can briefly call a cell
                        // render with an out-of-range `undefined` record
                        // while the (filtered) dataSource is shrinking —
                        // render nothing for those phantom rows.
                        if (record == null) return null
                        // Skeleton / not-yet-keyed rows (incl. comparison
                        // placeholders) render a fixed-height placeholder.
                        if (record.__isSkeleton || !record.scenarioId) {
                            return <EtlSkeletonCell />
                        }
                        return (
                            <EtlResolvedCell
                                projectId={projectId}
                                // Comparison rows carry their own runId.
                                runId={record.runId ?? runId}
                                scenarioId={record.scenarioId}
                                scenarioStatus={record.status}
                                columnKind={leaf.kind}
                                columnGroupSlug={leaf.groupSlug}
                                columnName={leaf.name}
                                schema={schema}
                            />
                        )
                    },
                }
            })

            return {
                key: g.group.key,
                columnVisibilityLabel: g.group.label,
                title: <EtlColumnHeader group={g.group} />,
                align: "left" as const,
                children,
            }
        })
    }, [projectId, runId, schema, columnResult])
}
