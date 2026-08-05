/**
 * ScenarioFilterBar — multi-condition AND/OR filter for the evaluation
 * run scenarios table (decision D8).
 *
 * Self-contained: given only a `runId` it derives the run schema, the
 * column value types, and the live scan status from atoms — so it can be
 * dropped into the run header rather than sitting above the table.
 *
 * Follows the observability `Filters` pattern: a compact "Filters" button
 * opens a popover holding the condition rows. Edits are staged in a draft
 * and committed on "Apply".
 */

import {useMemo, useState} from "react"

import {
    buildFilterSchema,
    type ColumnGroup,
    type FilterOperator,
    type FilterValueType,
    type PredicateGroup,
    type RowPredicate,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {Button, Divider, Input, InputNumber, Popover, Select, Tooltip} from "antd"
import {useAtom, useAtomValue} from "jotai"
import {Filter as FilterIcon, Loader2, Plus, X} from "lucide-react"

import {evaluationRunQueryAtomFamily, tableColumnsAtomFamily} from "../atoms/table"

import {buildColumnValueTypeResolver} from "./columnValueTypes"
import {
    scenarioFilterAtomFamily,
    isConditionComplete,
    scenarioFilterStatusAtomFamily,
} from "./scenarioFilterState"

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

// Operators offered in the UI. `in` / `nin` take a list of values (a tag
// input); the rest take a single value.
const UI_OPERATORS: FilterOperator[] = ["eq", "ne", "lt", "lte", "gt", "gte", "in", "nin"]

/** True for operators whose value is a list rather than a scalar. */
const isListOperator = (op: FilterOperator) => op === "in" || op === "nin"

/**
 * v1 column-kind allowlist for filtering. Only metric-related columns
 * (evaluator outputs + metrics) are offered for now; testset (input) and
 * application (output) columns are deliberately withheld.
 *
 * This is a UI allowlist only — the filter engine supports every kind.
 * Flip a kind to `true` here to enable it; no other change is needed.
 */
const FILTERABLE_COLUMN_KINDS: Record<ColumnGroup["kind"], boolean> = {
    evaluator: true,
    metrics: true,
    testset: false,
    application: false,
    other: false,
}

const EMPTY_FILTER: PredicateGroup = {op: "and", conditions: []}

const encodeField = (f: {groupKind: string; groupSlug?: string | null; columnName: string}) =>
    `${f.groupKind}|${f.groupSlug ?? ""}|${f.columnName}`

const blankCondition = (): RowPredicate => ({
    groupKind: "evaluator",
    groupSlug: null,
    columnName: "",
    op: "eq",
    value: "",
})

/** Keep antd Select dropdowns inside the popover so they don't close it. */
const getWithinPopover = (trigger: HTMLElement) =>
    (trigger.closest(".ant-popover") as HTMLElement | null) ?? document.body

export interface ScenarioFilterBarProps {
    runId: string
}

const ScenarioFilterBar = ({runId}: ScenarioFilterBarProps) => {
    const [applied, setApplied] = useAtom(scenarioFilterAtomFamily(runId))
    const {matchCount, scanning} = useAtomValue(scenarioFilterStatusAtomFamily(runId))
    const [open, setOpen] = useState(false)
    // Draft conditions edited inside the popover; committed on Apply.
    const [draft, setDraft] = useState<PredicateGroup>(applied)

    // Run schema (steps + mappings) — drives the filterable columns.
    const runQuery = useAtomValue(useMemo(() => evaluationRunQueryAtomFamily(runId), [runId]))
    const schema = useMemo<RunSchema | null>(() => {
        const data = runQuery.data?.rawRun?.data
        const steps = data?.steps
        const mappings = data?.mappings
        if (!Array.isArray(steps) || !Array.isArray(mappings)) return null
        return {steps, mappings}
    }, [runQuery.data])

    // Column value types — sourced from the evaluator output schemas.
    const columnResult = useAtomValue(useMemo(() => tableColumnsAtomFamily(runId), [runId]))
    const resolveValueType = useMemo(
        () => buildColumnValueTypeResolver(columnResult),
        [columnResult],
    )

    const fields = useMemo(
        () =>
            buildFilterSchema(schema, {resolveValueType}).fields.filter((f) => {
                if (!FILTERABLE_COLUMN_KINDS[f.groupKind]) return false
                // String-typed evaluator outputs are excluded for the same
                // reason they are hidden from the scenario table: their
                // per-scenario value is a `{type: "string", count: …}` stats
                // blob that `unwrapStatsForCompare` does not unwrap, so any
                // filter comparison would compare against a raw object and
                // never match. See `useEtlColumns.tsx`.
                //
                // Scoped to `evaluator` kind: `buildColumnValueTypeResolver`
                // has a column-name-only fallback, so a same-named metrics
                // column could otherwise inherit an evaluator's string
                // `metricType` and be incorrectly dropped.
                if (f.groupKind === "evaluator" && f.valueType === "string") return false
                return true
            }),
        [schema, resolveValueType],
    )
    const fieldByKey = useMemo(() => new Map(fields.map((f) => [encodeField(f), f])), [fields])

    // The filter-schema group label is a humanified slug (e.g. "Rubic
    // Zn3a"). The table column headers resolve the evaluator's configured
    // name onto every column as `evaluatorName` — reuse that here, keyed by
    // evaluator slug, so filter options read as evaluator names not slugs.
    const evaluatorNameBySlug = useMemo(() => {
        const map = new Map<string, string>()
        for (const col of columnResult?.columns ?? []) {
            if (col.evaluatorSlug && col.evaluatorName) {
                map.set(col.evaluatorSlug, col.evaluatorName)
            }
        }
        return map
    }, [columnResult])

    const fieldOptions = useMemo(
        () =>
            fields.map((f) => {
                const groupLabel =
                    (f.groupSlug ? evaluatorNameBySlug.get(f.groupSlug) : undefined) ?? f.groupLabel
                return {
                    value: encodeField(f),
                    label: `${groupLabel} · ${f.label}`,
                }
            }),
        [fields, evaluatorNameBySlug],
    )

    // Run graph carries no filterable columns — hide the bar entirely.
    if (fields.length === 0) return null

    const appliedCount = applied.conditions.filter(isConditionComplete).length
    const conditions = draft.conditions

    const setConditions = (next: RowPredicate[]) => setDraft((d) => ({...d, conditions: next}))
    const updateCondition = (index: number, partial: Partial<RowPredicate>) =>
        setConditions(conditions.map((c, i) => (i === index ? {...c, ...partial} : c)))
    const removeCondition = (index: number) =>
        setConditions(conditions.filter((_, i) => i !== index))

    const handleOpenChange = (next: boolean) => {
        if (next) {
            // Seed the draft from the applied filter (one blank row when empty).
            setDraft(
                applied.conditions.length > 0
                    ? applied
                    : {op: "and", conditions: [blankCondition()]},
            )
        }
        setOpen(next)
    }

    const apply = () => {
        setApplied({op: draft.op, conditions: draft.conditions.filter(isConditionComplete)})
        setOpen(false)
    }
    const clearAll = () => {
        setApplied(EMPTY_FILTER)
        setDraft(EMPTY_FILTER)
        setOpen(false)
    }

    const popoverContent = (
        <div className="flex w-[560px] max-w-[calc(100vw-32px)] flex-col text-xs">
            <div className="flex items-center justify-between gap-3 px-1 pb-2">
                <span className="font-medium text-zinc-600">Filter scenarios</span>
                {appliedCount > 0 ? (
                    <span className="inline-flex items-center gap-1 font-normal text-zinc-500">
                        {scanning ? <Loader2 size={12} className="animate-spin" /> : null}
                        <span>
                            {matchCount} {matchCount === 1 ? "match" : "matches"}
                            {scanning ? " · scanning…" : ""}
                        </span>
                    </span>
                ) : null}
            </div>
            <Divider className="!my-0 !mb-2" />

            <div className="flex flex-col gap-1.5">
                {conditions.map((condition, index) => {
                    const fieldKey = condition.columnName ? encodeField(condition) : undefined
                    const field = fieldKey ? fieldByKey.get(fieldKey) : undefined
                    const valueType: FilterValueType = field?.valueType ?? "unknown"
                    const ops = field
                        ? UI_OPERATORS.filter((o) => field.operators.includes(o))
                        : UI_OPERATORS

                    return (
                        <div key={index} className="flex items-center gap-1.5">
                            {/*
                             * Row-level AND/OR connector in a fixed-width
                             * slot — so the Column select after it lines up
                             * across every row regardless of whether the
                             * connector is the "Where" label or the select.
                             * The group has a single op (flat group — D8),
                             * so every connector shows and toggles the same
                             * value.
                             */}
                            <div className="flex w-20 shrink-0 items-center text-zinc-400">
                                {index === 0 ? (
                                    <span className="pl-2">Where</span>
                                ) : (
                                    <Select<"and" | "or">
                                        variant="borderless"
                                        className="w-full"
                                        value={draft.op}
                                        options={[
                                            {label: "And", value: "and"},
                                            {label: "Or", value: "or"},
                                        ]}
                                        getPopupContainer={getWithinPopover}
                                        onChange={(op) => setDraft((d) => ({...d, op}))}
                                    />
                                )}
                            </div>
                            <Select<string>
                                placeholder="Column"
                                className="w-[200px] shrink-0"
                                showSearch
                                optionFilterProp="label"
                                value={fieldKey}
                                options={fieldOptions}
                                getPopupContainer={getWithinPopover}
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
                                className="w-[110px] shrink-0"
                                value={condition.op}
                                disabled={!field}
                                options={ops.map((o) => ({value: o, label: OP_LABELS[o]}))}
                                getPopupContainer={getWithinPopover}
                                onChange={(op) => {
                                    // Switching between scalar and list
                                    // operators changes the value shape —
                                    // reset it so it stays valid.
                                    const isList = isListOperator(op)
                                    const wasList = Array.isArray(condition.value)
                                    const value =
                                        isList === wasList ? condition.value : isList ? [] : ""
                                    updateCondition(index, {op, value})
                                }}
                            />
                            <ConditionValueInput
                                op={condition.op}
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
            </div>

            <Button
                size="small"
                type="dashed"
                icon={<Plus size={14} />}
                className="mt-2 self-start"
                onClick={() => setConditions([...conditions, blankCondition()])}
            >
                Add condition
            </Button>

            <Divider className="!my-2" />
            <div className="flex items-center justify-between px-1">
                <Button size="small" onClick={clearAll} disabled={appliedCount === 0}>
                    Clear
                </Button>
                <div className="flex items-center gap-2">
                    <Button size="small" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button size="small" type="primary" onClick={apply}>
                        Apply
                    </Button>
                </div>
            </div>
        </div>
    )

    return (
        <Popover
            open={open}
            onOpenChange={handleOpenChange}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            content={popoverContent}
        >
            <Button
                icon={<FilterIcon size={14} />}
                aria-label="Filter scenarios"
                className="inline-flex items-center gap-1"
            >
                <span
                    className={`rounded-full px-1.5 text-[10px] font-medium ${
                        appliedCount > 0
                            ? "bg-zinc-700 text-white"
                            : "bg-zinc-100 dark:bg-[var(--ag-rgba-051729-06)] text-zinc-500"
                    }`}
                >
                    {appliedCount}
                </span>
            </Button>
        </Popover>
    )
}

/** Value input — shape depends on the operator and the field value type. */
const ConditionValueInput = ({
    op,
    valueType,
    value,
    disabled,
    onChange,
}: {
    op: FilterOperator
    valueType: FilterValueType
    value: unknown
    disabled: boolean
    onChange: (value: unknown) => void
}) => {
    // `in` / `nin` — a list of values entered as tags.
    if (isListOperator(op)) {
        const tags = Array.isArray(value) ? value.map((v) => String(v)) : []
        return (
            <Select
                mode="tags"
                className="w-full"
                placeholder="Add values…"
                disabled={disabled}
                value={tags}
                open={false}
                suffixIcon={null}
                tokenSeparators={[","]}
                getPopupContainer={getWithinPopover}
                onChange={(vals: string[]) => {
                    const coerced =
                        valueType === "number"
                            ? vals.map(Number).filter((n) => !Number.isNaN(n))
                            : vals
                    onChange(coerced)
                }}
            />
        )
    }
    if (valueType === "boolean") {
        // antd Select option values must be string|number — encode the
        // boolean as a string and decode on change.
        return (
            <Select<string>
                className="w-full"
                placeholder="Value"
                disabled={disabled}
                value={value === true ? "true" : value === false ? "false" : undefined}
                options={[
                    {label: "true", value: "true"},
                    {label: "false", value: "false"},
                ]}
                getPopupContainer={getWithinPopover}
                onChange={(v) => onChange(v === "true")}
            />
        )
    }
    if (valueType === "number") {
        return (
            <InputNumber
                className="w-full"
                placeholder="Value"
                disabled={disabled}
                value={typeof value === "number" ? value : null}
                onChange={(v) => onChange(v ?? "")}
            />
        )
    }
    return (
        <Input
            className="w-full"
            placeholder="Value"
            disabled={disabled}
            value={typeof value === "string" ? value : value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}

export default ScenarioFilterBar
