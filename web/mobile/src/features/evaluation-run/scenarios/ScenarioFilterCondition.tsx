import {
    isListOperator,
    type FilterOperator,
    type RowPredicate,
} from "@agenta/entities/evaluationRun/etl"
import {Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

import {ScenarioFilterValue} from "./ScenarioFilterValue"
import {scenarioFilterFieldId, type ScenarioFilterField} from "./useScenarioFilter"

/** The operator words of the old app's filter. */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
    eq: "equals",
    ne: "not equals",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    in: "in",
    nin: "not in",
}

/**
 * One condition of the filter: "Where" (or the And / Or pick from the second row on), the column,
 * the operator, the value, and a remove button.
 */
export const ScenarioFilterCondition = ({
    index,
    condition,
    join,
    fields,
    onJoinChange,
    onChange,
    onRemove,
}: {
    index: number
    condition: RowPredicate
    join: "and" | "or"
    fields: ScenarioFilterField[]
    onJoinChange: (join: "and" | "or") => void
    onChange: (condition: RowPredicate) => void
    onRemove: () => void
}) => {
    const fieldId = condition.columnName ? scenarioFilterFieldId(condition) : undefined
    const field = fields.find((entry) => entry.id === fieldId)
    const operators = field?.operators ?? []
    const position = index + 1

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-16 shrink-0 text-xs text-muted-foreground">
                {index === 0 ? (
                    <span className="pl-1">Where</span>
                ) : (
                    <Select
                        value={join}
                        onValueChange={(next) => onJoinChange(next === "or" ? "or" : "and")}
                    >
                        <SelectTrigger
                            size="sm"
                            variant="ghost"
                            aria-label={`Join of condition ${position}`}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="and">And</SelectItem>
                            <SelectItem value="or">Or</SelectItem>
                        </SelectContent>
                    </Select>
                )}
            </div>
            <Select
                value={field?.id}
                onValueChange={(id) => {
                    const picked = fields.find((entry) => entry.id === id)
                    if (!picked) return
                    onChange({
                        groupKind: picked.groupKind,
                        groupSlug: picked.groupSlug,
                        columnName: picked.columnName,
                        op: picked.operators[0] ?? "eq",
                        value: "",
                    })
                }}
            >
                <SelectTrigger
                    size="sm"
                    aria-label={`Column of condition ${position}`}
                    className="w-[200px] min-w-0"
                >
                    <SelectValue placeholder="Column" />
                </SelectTrigger>
                <SelectContent>
                    {fields.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                            {entry.groupLabel} · {entry.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select
                value={condition.op}
                disabled={!field}
                onValueChange={(next) => {
                    const op = next as FilterOperator
                    // A list and a single value have different shapes: switching between them
                    // clears the value so it stays valid.
                    const sameShape = isListOperator(op) === isListOperator(condition.op)
                    onChange({...condition, op, value: sameShape ? condition.value : ""})
                }}
            >
                <SelectTrigger
                    size="sm"
                    aria-label={`Operator of condition ${position}`}
                    className="w-[110px]"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {operators.map((op) => (
                        <SelectItem key={op} value={op}>
                            {OPERATOR_LABELS[op]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <ScenarioFilterValue
                // A new column or operator starts the typed text over.
                key={`${fieldId ?? ""}|${condition.op}`}
                op={condition.op}
                valueType={field?.valueType ?? "unknown"}
                value={condition.value}
                disabled={!field}
                onChange={(value) => onChange({...condition, value})}
            />
            <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove condition ${position}`}
                onClick={onRemove}
            >
                <X aria-hidden size={14} />
            </Button>
        </div>
    )
}
