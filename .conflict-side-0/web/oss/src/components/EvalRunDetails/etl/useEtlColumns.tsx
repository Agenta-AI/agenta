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

import type {PreviewTableRow} from "../atoms/tableRows"

import EtlResolvedCell, {EtlSkeletonCell} from "./cells/EtlResolvedCell"
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
     * Each comparison run's own schema, keyed by runId. Comparison rows
     * resolve their application/output cells against the comparison run's
     * schema — its invocation step keys (and app slug) differ from the base
     * run's, so resolving against the base schema yields no match ("—").
     */
    comparisonSchemas?: Record<string, RunSchema | null>
}

/**
 * Schema columns for the scenario table, as nested-header IVT columns.
 * Empty until the run schema is available.
 */
export const useEtlColumns = ({
    projectId,
    runId,
    schema,
    comparisonSchemas,
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
        const grouped = groupRunColumns(schema.steps, schema.mappings).filter(
            (g) => g.group.kind !== "metrics",
        )

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
                    // `ellipsis: true` is intentionally NOT set here. Antd
                    // applies `white-space: nowrap` to the cell when it is,
                    // which collapses our multi-line content (e.g. an
                    // evaluator's `reasoning` string) onto a single line.
                    // The body cell is `EtlResolvedCell`, which already
                    // clamps to a row-height-derived line count via
                    // `-webkit-line-clamp`. The header has its own
                    // ellipsis-ing inside the `Tooltip` span above.
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
                        // Comparison rows carry their own runId. Resolve them
                        // against the comparison run's *own* schema — its
                        // invocation step keys differ from the base run's, so
                        // resolving against the base schema finds no result
                        // and the cell renders "—".
                        const cellRunId = record.runId ?? runId
                        const isComparison = cellRunId !== runId
                        const cellSchema = isComparison
                            ? (comparisonSchemas?.[cellRunId] ?? null)
                            : schema
                        // Comparison run's schema not resolved yet — keep a
                        // skeleton rather than flashing "—".
                        if (isComparison && !cellSchema) {
                            return <EtlSkeletonCell />
                        }
                        return (
                            <EtlResolvedCell
                                projectId={projectId}
                                runId={cellRunId}
                                scenarioId={record.scenarioId}
                                scenarioStatus={record.status}
                                columnKind={leaf.kind}
                                // Match comparison columns by kind + name only:
                                // the group slug is derived from the app slug,
                                // which differs per run.
                                columnGroupSlug={isComparison ? null : leaf.groupSlug}
                                columnName={leaf.name}
                                schema={cellSchema}
                            />
                        )
                    },
                }
            })

            return {
                key: g.group.key,
                columnVisibilityLabel: g.group.label,
                title: <EtlColumnHeader group={g.group} runId={runId} />,
                align: "left" as const,
                children,
            }
        })
    }, [projectId, runId, schema, comparisonSchemas])
}
