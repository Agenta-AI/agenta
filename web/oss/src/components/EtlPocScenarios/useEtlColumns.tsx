/**
 * useEtlColumns
 *
 * Derives IVT column definitions from a run's schema (steps + mappings).
 * Mirrors the headless PoC's column grouping but emits Ant Design /
 * InfiniteVirtualTable column objects with a per-cell render that mounts
 * `EtlResolvedCell`.
 *
 * Grouping is computed once per (schema identity) and gives us the same
 * 4-group layout the scenarios table shows:
 *
 *   Testset <slug>  | Application <slug>  | <Evaluator>  | Metrics
 *      column(s)         column(s)            column(s)     column(s)
 *
 * One group → one Ant nested-header object; one column → one leaf with
 * the cell renderer.
 */

import {useMemo} from "react"

import {
    computeColumnGroup,
    type RunMapping,
    type RunSchema,
    type RunStep,
    type ColumnGroup,
} from "@agenta/entities/evaluationRun/etl"

import EtlResolvedCell, {EtlSkeletonCell} from "./cells/EtlResolvedCell"
import EtlColumnHeader from "./EtlColumnHeader"
import type {ScenarioThinRow} from "./scenarioPaginatedStore"

interface ColumnLeaf {
    name: string
    /** Narrowed: "other" columns are filtered out during grouping. */
    kind: "testset" | "application" | "evaluator" | "metrics"
    groupSlug: string | null
}
interface GroupedColumns {
    group: ColumnGroup
    columns: ColumnLeaf[]
}

function groupMappings(steps: RunStep[], mappings: RunMapping[]): GroupedColumns[] {
    const stepByKey = new Map<string, RunStep>()
    for (const s of steps) stepByKey.set(s.key, s)

    const byKey = new Map<string, GroupedColumns>()
    for (const mapping of mappings) {
        const columnName = mapping.column?.name
        if (typeof columnName !== "string" || !columnName) continue
        const step = mapping.step?.key ? (stepByKey.get(mapping.step.key) ?? null) : null
        const path = mapping.step?.path ?? ""
        const group = computeColumnGroup(step, path)
        // "other" columns have no clear group source — skip in the test page.
        if (group.kind === "other") continue

        let slot = byKey.get(group.key)
        if (!slot) {
            slot = {group, columns: []}
            byKey.set(group.key, slot)
        }
        slot.columns.push({
            name: columnName,
            // group.kind has already been narrowed: "other" is skipped above.
            kind: group.kind as ColumnLeaf["kind"],
            groupSlug: group.slug,
        })
    }
    // Stable order: testset → application → evaluator(s) → metrics → other.
    const orderKind: Record<ColumnGroup["kind"], number> = {
        testset: 0,
        application: 1,
        evaluator: 2,
        metrics: 3,
        other: 4,
    }
    return Array.from(byKey.values()).sort((a, b) => {
        const k = orderKind[a.group.kind] - orderKind[b.group.kind]
        if (k !== 0) return k
        return (a.group.label ?? "").localeCompare(b.group.label ?? "")
    })
}

export interface UseEtlColumnsArgs {
    projectId: string | null
    runId: string | null
    schema: RunSchema | null
}

export interface EtlColumnDef {
    /** Stable column key for IVT. */
    key: string
    /** Ant table column header. ReactNode so the header can subscribe to
     *  entity reference atoms for friendlier labels (Testset *name* vs
     *  Testset *slug*). */
    title: React.ReactNode
    width: number
    /** Group metadata (for headers, debug). */
    group: ColumnGroup
    leaf: ColumnLeaf
    render: (_: unknown, record: ScenarioThinRow) => React.ReactNode
}

export const useEtlColumns = ({projectId, runId, schema}: UseEtlColumnsArgs): EtlColumnDef[] => {
    return useMemo(() => {
        if (!schema || !projectId || !runId) return []
        const grouped = groupMappings(schema.steps, schema.mappings)
        const cols: EtlColumnDef[] = []
        for (const g of grouped) {
            for (const c of g.columns) {
                const key = `${g.group.key}::${c.name}`
                cols.push({
                    key,
                    // Header is a component so it can subscribe to entity
                    // reference atoms (testset name vs slug, application
                    // name vs slug). Same approach production's
                    // `StepGroupHeader` uses. Evaluator + metrics headers
                    // fall through to `group.label` which is already
                    // `slugToTitle`-rendered ("Exact Match" etc.).
                    title: <EtlColumnHeader group={g.group} columnName={c.name} />,
                    width: 200,
                    group: g.group,
                    leaf: c,
                    render: (_: unknown, record: ScenarioThinRow) => {
                        // `record.key` is the IVT row identity
                        // (`${runId}::${rowKey}`); `scenarioId` is the
                        // actual scenario UUID written by `mergeRow`. Cells
                        // need the latter to query molecule caches.
                        const scenarioId = record.scenarioId
                        // Skeleton / not-yet-keyed rows render a
                        // fixed-height placeholder (not null) so the row
                        // height matches a populated row — no jump on load.
                        if (!scenarioId || record.__isSkeleton) return <EtlSkeletonCell />
                        return (
                            <EtlResolvedCell
                                projectId={projectId}
                                runId={runId}
                                scenarioId={scenarioId}
                                columnKind={c.kind}
                                columnGroupSlug={c.groupSlug}
                                columnName={c.name}
                                schema={schema}
                            />
                        )
                    },
                })
            }
        }
        return cols
    }, [projectId, runId, schema])
}
