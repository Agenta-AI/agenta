/**
 * ScenarioFilterBar — multi-condition AND/OR filter for the evaluation
 * run scenarios table (decision D8).
 *
 * Follows the observability `Filters` pattern: a compact "Filters" button
 * opens a popover holding the condition rows, so the conditions never
 * take over the page layout. Edits are staged in a draft and committed on
 * "Apply" (so the table is not re-scanned on every keystroke).
 *
 * Columns come from `buildFilterSchema` (run graph); column value types
 * come from the evaluator output schema via `resolveValueType`, which
 * drives the operator set and the value input.
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
import {Button, Divider, Input, InputNumber, Popover, Segmented, Select, Tooltip} from "antd"
import {useAtom} from "jotai"
import {Filter as FilterIcon, Loader2, Plus, X} from "lucide-react"

import {scenarioFilterAtomFamily, isConditionComplete} from "./scenarioFilterState"

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
    schema: RunSchema | null
    /** Column value-type resolver, sourced from the evaluator output schema. */
    resolveValueType: (field: {
        groupKind: string
        groupSlug: string | null
        columnName: string
    }) => FilterValueType | undefined
    /** True while the filter scan is still running. */
    scanning?: boolean
    /** Confirmed matches found so far. */
    matchCount?: number
}

const ScenarioFilterBar = ({
    runId,
    schema,
    resolveValueType,
    scanning = false,
    matchCount = 0,
}: ScenarioFilterBarProps) => {
    const [applied, setApplied] = useAtom(scenarioFilterAtomFamily(runId))
    const [open, setOpen] = useState(false)
    // Draft conditions edited inside the popover; committed on Apply.
    const [draft, setDraft] = useState<PredicateGroup>(applied)

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
            <div className="px-1 pb-2 font-medium text-zinc-600">Filter scenarios</div>
            <Divider className="!my-0 !mb-2" />

            {conditions.length >= 2 && (
                <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="text-zinc-400">Match</span>
                    <Segmented<"and" | "or">
                        size="small"
                        value={draft.op}
                        options={[
                            {label: "All (AND)", value: "and"},
                            {label: "Any (OR)", value: "or"},
                        ]}
                        onChange={(op) => setDraft((d) => ({...d, op}))}
                    />
                </div>
            )}

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
                            <span className="w-10 shrink-0 text-zinc-400">
                                {index === 0 ? "Where" : draft.op === "and" ? "And" : "Or"}
                            </span>
                            <Select<string>
                                size="small"
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
                                size="small"
                                className="w-[110px] shrink-0"
                                value={condition.op}
                                disabled={!field}
                                options={ops.map((o) => ({value: o, label: OP_LABELS[o]}))}
                                getPopupContainer={getWithinPopover}
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
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 text-xs">
            <Popover
                open={open}
                onOpenChange={handleOpenChange}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                content={popoverContent}
            >
                <Button size="small" icon={<FilterIcon size={14} />}>
                    Filters
                    {appliedCount > 0 && (
                        <span className="ml-1 rounded-full bg-zinc-700 px-1.5 text-[10px] font-medium text-white">
                            {appliedCount}
                        </span>
                    )}
                </Button>
            </Popover>

            {appliedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-zinc-500">
                    {scanning && <Loader2 size={12} className="animate-spin" />}
                    <span>
                        {matchCount} {matchCount === 1 ? "match" : "matches"}
                        {scanning ? " · scanning…" : ""}
                    </span>
                </span>
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
                size="small"
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
            size="small"
            className="w-full"
            placeholder="Value"
            disabled={disabled}
            value={typeof value === "string" ? value : value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}

export default ScenarioFilterBar
