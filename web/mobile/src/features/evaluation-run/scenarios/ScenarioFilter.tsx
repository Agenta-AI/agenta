import {useState} from "react"

import {
    EMPTY_SCENARIO_FILTER,
    isConditionComplete,
    toEffectiveFilter,
    type PredicateGroup,
    type RowPredicate,
} from "@agenta/entities/evaluationRun/etl"
import {Button, Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
import {Funnel, Plus} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {ScenarioFilterCondition} from "./ScenarioFilterCondition"
import {scenarioFilterAtomFamily} from "./scenarioTableState"
import type {ScenarioFilterField} from "./useScenarioFilter"

const blankCondition = (): RowPredicate => ({
    groupKind: "evaluator",
    groupSlug: null,
    columnName: "",
    op: "eq",
    value: "",
})

/**
 * The scenario filter, as in the old app: conditions on evaluator outputs and metrics, all joined
 * by And or by Or. The conditions are edited in a draft and applied with Apply.
 */
export const ScenarioFilter = ({
    runId,
    applied,
    fields,
    matchCount,
    scanning,
}: {
    runId: string
    applied: PredicateGroup
    fields: ScenarioFilterField[]
    matchCount: number
    scanning: boolean
}) => {
    const setApplied = useSetAtom(scenarioFilterAtomFamily(runId))
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<PredicateGroup>(applied)
    const appliedCount = applied.conditions.filter(isConditionComplete).length

    const onOpenChange = (next: boolean) => {
        // The draft starts from the applied filter, with one empty row when there is none.
        if (next) {
            setDraft(
                applied.conditions.length > 0
                    ? applied
                    : {op: "and", conditions: [blankCondition()]},
            )
        }
        setOpen(next)
    }
    const setConditions = (conditions: RowPredicate[]) =>
        setDraft((current) => ({...current, conditions}))

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Filter scenarios">
                    <Funnel aria-hidden size={14} />
                    <span>{appliedCount > 0 ? `Filter (${appliedCount})` : "Filter"}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[600px] max-w-[calc(100vw-32px)] p-3">
                <div className="flex items-center justify-between gap-3 pb-2">
                    <span className="text-sm font-medium">Filter scenarios</span>
                    {appliedCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            {scanning ? <Spinner size="small" /> : null}
                            {matchCount} {matchCount === 1 ? "match" : "matches"}
                            {scanning ? " · scanning…" : ""}
                        </span>
                    ) : null}
                </div>
                <div className="flex flex-col gap-1.5 border-0 border-t border-solid border-border pt-2">
                    {draft.conditions.map((condition, index) => (
                        <ScenarioFilterCondition
                            key={index}
                            index={index}
                            condition={condition}
                            join={draft.op}
                            fields={fields}
                            onJoinChange={(op) => setDraft((current) => ({...current, op}))}
                            onChange={(next) =>
                                setConditions(
                                    draft.conditions.map((entry, position) =>
                                        position === index ? next : entry,
                                    ),
                                )
                            }
                            onRemove={() =>
                                setConditions(
                                    draft.conditions.filter((_, position) => position !== index),
                                )
                            }
                        />
                    ))}
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => setConditions([...draft.conditions, blankCondition()])}
                >
                    <Plus aria-hidden size={14} />
                    Add condition
                </Button>
                <div className="mt-2 flex items-center justify-between border-0 border-t border-solid border-border pt-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={appliedCount === 0}
                        onClick={() => {
                            setApplied(EMPTY_SCENARIO_FILTER)
                            setOpen(false)
                        }}
                    >
                        Clear
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => {
                                setApplied(toEffectiveFilter(draft))
                                setOpen(false)
                            }}
                        >
                            Apply
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
