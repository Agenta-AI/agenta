/**
 * ScenarioFilterBar — multi-condition AND/OR filter for the evaluation
 * run scenarios table (decision D8).
 *
 * Columns come from `buildFilterSchema` (run graph). Each condition is a
 * (column, operator, value) clause; conditions are joined by a single
 * AND/OR operator. The bar writes a `PredicateGroup` to the per-run
 * filter atom — `useScenarioFilter` reads it and filters the rows.
 *
 * Column value types come from the evaluator output schema via the
 * `resolveValueType` prop (see `columnValueTypes`). That drives the
 * operator set and the value input — a boolean output gets only
 * equality operators + a true/false input, a numeric one gets the
 * comparators.
 */

import {useCallback, useMemo} from "react"

import {
    buildFilterSchema,
    type ColumnGroup,
    type FilterOperator,
    type FilterValueType,
    type RowPredicate,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {Button, Input, InputNumber, Segmented, Select, Tooltip} from "antd"
import {useAtom} from "jotai"
import {Plus, X} from "lucide-react"

import {scenarioFilterAtomFamily, isScenarioFilterActive} from "./scenarioFilterState"

const OP_LABELS: Record<FilterOperator, string> = {
    eq: "equals",
    ne: "not equals",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    in: "in",
    nin: "not in",
}

// Operators offered in the UI. `in` / `nin` are supported by the filter
// engine but need an array-value input — deferred from this v1 bar.
const UI_OPERATORS: FilterOperator[] = ["eq", "ne", "lt", "lte", "gt", "gte"]

/**
 * v1 column-kind allowlist for filtering. Only metric-related columns
 * (evaluator outputs + metrics) are offered for now; testset (input) and
 * application (output) columns are deliberately withheld.
 *
 * This is a UI allowlist only — the filter engine (`evaluateRowFilter`,
 * `predicateToEntitySlices`) supports every kind. Flip a kind to `true`
 * here to enable it; no other change is needed.
 */
const FILTERABLE_COLUMN_KINDS: Record<ColumnGroup["kind"], boolean> = {
    evaluator: true,
    metrics: true,
    testset: false,
    application: false,
    other: false,
}

const encodeField = (f: {groupKind: string; groupSlug?: string | null; columnName: string}) =>
    `${f.groupKind}|${f.groupSlug ?? ""}|${f.columnName}`

const blankCondition = (): RowPredicate => ({
    groupKind: "evaluator",
    groupSlug: null,
    columnName: "",
    op: "eq",
    value: "",
})

export interface ScenarioFilterBarProps {
    runId: string
    schema: RunSchema | null
    /** Column value-type resolver, sourced from the evaluator output schema. */
    resolveValueType: (field: {
        groupKind: string
        groupSlug: string | null
        columnName: string
    }) => FilterValueType | undefined
}

const ScenarioFilterBar = ({runId, schema, resolveValueType}: ScenarioFilterBarProps) => {
    const [filter, setFilter] = useAtom(scenarioFilterAtomFamily(runId))

    const fields = useMemo(
        () =>
            buildFilterSchema(schema, {resolveValueType}).fields.filter(
                (f) => FILTERABLE_COLUMN_KINDS[f.groupKind],
            ),
        [schema, resolveValueType],
    )
    const fieldByKey = useMemo(() => new Map(fields.map((f) => [encodeField(f), f])), [fields])
    const fieldOptions = useMemo(
        () =>
            fields.map((f) => ({
                value: encodeField(f),
                label: `${f.groupLabel} · ${f.label}`,
            })),
        [fields],
    )

    const conditions = filter.conditions

    const setConditions = useCallback(
        (next: RowPredicate[]) => setFilter((prev) => ({...prev, conditions: next})),
        [setFilter],
    )
    const updateCondition = useCallback(
        (index: number, partial: Partial<RowPredicate>) =>
            setConditions(conditions.map((c, i) => (i === index ? {...c, ...partial} : c))),
        [conditions, setConditions],
    )
    const removeCondition = useCallback(
        (index: number) => setConditions(conditions.filter((_, i) => i !== index)),
        [conditions, setConditions],
    )

    // Run graph carries no filterable columns — hide the bar entirely.
    if (fields.length === 0) return null

    const active = isScenarioFilterActive(filter)

    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 text-xs">
            <span className="font-medium text-zinc-600">Filters</span>

            {conditions.length >= 2 && (
                <Segmented<"and" | "or">
                    size="small"
                    value={filter.op}
                    options={[
                        {label: "AND", value: "and"},
                        {label: "OR", value: "or"},
                    ]}
                    onChange={(op) => setFilter((prev) => ({...prev, op}))}
                />
            )}

            {conditions.map((condition, index) => {
                const fieldKey = condition.columnName ? encodeField(condition) : undefined
                const field = fieldKey ? fieldByKey.get(fieldKey) : undefined
                const valueType: FilterValueType = field?.valueType ?? "unknown"
                const ops = field
                    ? UI_OPERATORS.filter((o) => field.operators.includes(o))
                    : UI_OPERATORS

                return (
                    <div
                        key={index}
                        className="flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-1"
                    >
                        {index > 0 && (
                            <span className="mr-0.5 uppercase text-zinc-400">{filter.op}</span>
                        )}
                        <Select<string>
                            placeholder="Column"
                            style={{minWidth: 200}}
                            showSearch
                            optionFilterProp="label"
                            value={fieldKey}
                            options={fieldOptions}
                            onChange={(value) => {
                                const picked = fieldByKey.get(value)
                                if (!picked) return
                                const nextOps = UI_OPERATORS.filter((o) =>
                                    picked.operators.includes(o),
                                )
                                updateCondition(index, {
                                    groupKind: picked.groupKind,
                                    groupSlug: picked.groupSlug,
                                    columnName: picked.columnName,
                                    op: nextOps[0] ?? "eq",
                                    value: picked.valueType === "boolean" ? true : "",
                                })
                            }}
                        />
                        <Select<FilterOperator>
                            style={{minWidth: 104}}
                            value={condition.op}
                            disabled={!field}
                            options={ops.map((o) => ({value: o, label: OP_LABELS[o]}))}
                            onChange={(op) => updateCondition(index, {op})}
                        />
                        <ConditionValueInput
                            valueType={valueType}
                            value={condition.value}
                            disabled={!field}
                            onChange={(value) => updateCondition(index, {value})}
                        />
                        <Tooltip title="Remove">
                            <Button
                                size="small"
                                type="text"
                                icon={<X size={14} />}
                                onClick={() => removeCondition(index)}
                            />
                        </Tooltip>
                    </div>
                )
            })}

            <Button
                size="small"
                type="dashed"
                icon={<Plus size={14} />}
                onClick={() => setConditions([...conditions, blankCondition()])}
            >
                Add filter
            </Button>

            {active && (
                <Button
                    size="small"
                    type="text"
                    onClick={() => setFilter({op: "and", conditions: []})}
                >
                    Clear
                </Button>
            )}
        </div>
    )
}

/** Value input — shape depends on the field's (best-effort) value type. */
const ConditionValueInput = ({
    valueType,
    value,
    disabled,
    onChange,
}: {
    valueType: FilterValueType
    value: unknown
    disabled: boolean
    onChange: (value: unknown) => void
}) => {
    if (valueType === "boolean") {
        // antd Select option values must be string|number — encode the
        // boolean as a string and decode on change.
        return (
            <Select<string>
                size="small"
                style={{minWidth: 96}}
                placeholder="Value"
                disabled={disabled}
                value={value === true ? "true" : value === false ? "false" : undefined}
                options={[
                    {label: "true", value: "true"},
                    {label: "false", value: "false"},
                ]}
                onChange={(v) => onChange(v === "true")}
            />
        )
    }
    if (valueType === "number") {
        return (
            <InputNumber
                size="small"
                style={{width: 120}}
                placeholder="Value"
                disabled={disabled}
                value={typeof value === "number" ? value : null}
                onChange={(v) => onChange(v ?? "")}
            />
        )
    }
    return (
        <Input
            size="small"
            style={{width: 140}}
            placeholder="Value"
            disabled={disabled}
            value={typeof value === "string" ? value : value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}

export default ScenarioFilterBar
