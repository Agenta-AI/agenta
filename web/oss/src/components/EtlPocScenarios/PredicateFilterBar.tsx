/**
 * PredicateFilterBar
 *
 * Minimal filter UI: one predicate. Reads available
 * evaluator-output columns from the run schema and lets the user pick
 * (column, op, value). The parent owns the resulting `RowPredicate | null`
 * and passes it through to the table to filter rows post-hydrate.
 *
 * Same v1 client-side predicate the headless PoC + filtering RFC §D2
 * describe — value-equality against resolved UI columns, with
 * `unwrapStatsForCompare` applied on the actual value before compare.
 */

import {useMemo} from "react"

import {
    computeColumnGroup,
    type RunSchema,
    type RowPredicate,
} from "@agenta/entities/evaluationRun/etl"
import {Button, Select, Space} from "antd"

interface PredicateOption {
    label: string
    value: string
    /** Encoded as `<kind>:<slug>:<column>` to make the dropdown's value scalar. */
    kind: "testset" | "application" | "evaluator" | "metrics" | "other"
    slug: string | null
    column: string
}

export interface PredicateFilterBarProps {
    schema: RunSchema | null
    predicate: RowPredicate | null
    onChange: (next: RowPredicate | null) => void
}

const OPS: {label: string; value: RowPredicate["op"]}[] = [
    {label: "equals", value: "eq"},
    {label: "not equals", value: "ne"},
    {label: "<", value: "lt"},
    {label: "≤", value: "lte"},
    {label: ">", value: "gt"},
    {label: "≥", value: "gte"},
]

const PredicateFilterBar = ({schema, predicate, onChange}: PredicateFilterBarProps) => {
    const columnOptions: PredicateOption[] = useMemo(() => {
        if (!schema) return []
        const stepByKey = new Map(schema.steps.map((s) => [s.key, s]))
        const out: PredicateOption[] = []
        for (const m of schema.mappings) {
            const columnName = m.column?.name
            if (typeof columnName !== "string" || !columnName) continue
            const step = m.step?.key ? (stepByKey.get(m.step.key) ?? null) : null
            const group = computeColumnGroup(step, m.step?.path ?? "")
            // Only include columns useful for filtering — evaluators + metrics
            // (testset/application columns are filterable too but rarely used
            // for "which scenarios match this annotation" queries).
            if (group.kind !== "evaluator" && group.kind !== "metrics") continue
            out.push({
                label: `${group.label} · ${columnName}`,
                value: `${group.kind}:${group.slug ?? ""}:${columnName}`,
                kind: group.kind,
                slug: group.slug,
                column: columnName,
            })
        }
        return out
    }, [schema])

    const selectedColumnValue = predicate
        ? `${predicate.groupKind}:${predicate.groupSlug ?? ""}:${predicate.columnName}`
        : undefined

    const op = predicate?.op ?? "eq"

    const valueOptions = useMemo(() => {
        // Most evaluator annotations are binary. Numeric metrics need a
        // typed input; for v1 we just expose true/false + a free-text field.
        return [
            {label: "true", value: "true"},
            {label: "false", value: "false"},
        ]
    }, [])

    function update(nextPartial: Partial<RowPredicate>) {
        const merged: RowPredicate = {
            groupKind: predicate?.groupKind ?? "evaluator",
            groupSlug: predicate?.groupSlug ?? null,
            columnName: predicate?.columnName ?? "",
            op: predicate?.op ?? "eq",
            value: predicate?.value ?? true,
            ...nextPartial,
        }
        if (!merged.columnName) {
            onChange(null)
            return
        }
        onChange(merged)
    }

    return (
        <Space size="small" className="px-2 py-2 border-b border-zinc-200 bg-zinc-50">
            <span className="text-xs text-zinc-500">Predicate</span>
            <Select<string>
                placeholder="Column"
                size="small"
                style={{minWidth: 260}}
                value={selectedColumnValue}
                options={columnOptions}
                onChange={(value) => {
                    const found = columnOptions.find((o) => o.value === value)
                    if (!found) return
                    update({
                        groupKind: found.kind as RowPredicate["groupKind"],
                        groupSlug: found.slug,
                        columnName: found.column,
                    })
                }}
                allowClear
                onClear={() => onChange(null)}
            />
            <Select<RowPredicate["op"]>
                size="small"
                style={{minWidth: 110}}
                value={op}
                options={OPS}
                disabled={!predicate}
                onChange={(value) => update({op: value})}
            />
            <Select<string>
                size="small"
                style={{minWidth: 120}}
                value={
                    predicate?.value === true
                        ? "true"
                        : predicate?.value === false
                          ? "false"
                          : undefined
                }
                options={valueOptions}
                disabled={!predicate}
                onChange={(value) => update({value: value === "true"})}
            />
            <Button size="small" onClick={() => onChange(null)} disabled={!predicate}>
                Clear
            </Button>
            {predicate && (
                <span className="text-xs text-zinc-500">
                    {predicate.groupKind}:{predicate.groupSlug ?? ""}.{predicate.columnName}{" "}
                    {predicate.op} {JSON.stringify(predicate.value)}
                </span>
            )}
        </Space>
    )
}

export default PredicateFilterBar
