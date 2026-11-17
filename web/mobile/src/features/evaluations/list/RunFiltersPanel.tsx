import {useState} from "react"

import {
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Funnel} from "@phosphor-icons/react"

import {MultiCheckMenu} from "./MultiCheckMenu"
import {
    countRunFilters,
    EMPTY_RUN_FILTERS,
    RUN_DATE_RANGES,
    RUN_STATUS_OPTIONS,
    RUN_TYPE_OPTIONS,
    type RunFilterValues,
} from "./useEvaluationRunsFilters"
import type {ReferenceFilterKey} from "./useEvaluationRunsFilters"
import type {FilterOption} from "./useRunFilterOptions"

const ALL_TIME = "all"

/**
 * The old app's filter panel: Status, Type, Queries, Evaluators, Test sets, Variants and Date
 * range. Changes are a draft until Apply; Reset clears the draft. Type shows on the All tab only,
 * Variants need an app picked first.
 */
export const RunFiltersPanel = ({
    value,
    onApply,
    options,
    onOpenChange,
    showType,
    appPicked,
}: {
    value: RunFilterValues
    onApply: (next: RunFilterValues) => void
    options: Record<ReferenceFilterKey, FilterOption[]>
    onOpenChange: (open: boolean) => void
    showType: boolean
    appPicked: boolean
}) => {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(value)
    const count = countRunFilters(value)

    const toggle = (next: boolean) => {
        if (next) setDraft(value)
        setOpen(next)
        onOpenChange(next)
    }
    const setReferences = (key: ReferenceFilterKey, ids: string[]) =>
        setDraft((current) => ({...current, references: {...current.references, [key]: ids}}))
    const changed = JSON.stringify(draft) !== JSON.stringify(value)

    return (
        <Popover open={open} onOpenChange={toggle}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Filters">
                    <Funnel aria-hidden size={14} />
                    <span className="min-w-4 rounded-sm bg-muted px-1 text-xs tabular-nums text-foreground">
                        {count}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(420px,calc(100vw-32px))] p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <MultiCheckMenu
                        label="Status"
                        placeholder="Select statuses"
                        options={RUN_STATUS_OPTIONS}
                        value={draft.statuses}
                        onChange={(statuses) => setDraft((current) => ({...current, statuses}))}
                    />
                    {showType ? (
                        <MultiCheckMenu
                            label="Type"
                            placeholder="Select evaluation types"
                            options={RUN_TYPE_OPTIONS}
                            value={draft.types}
                            onChange={(types) =>
                                setDraft((current) => ({
                                    ...current,
                                    types: RUN_TYPE_OPTIONS.map((option) => option.value).filter(
                                        (kind) => types.includes(kind),
                                    ),
                                }))
                            }
                        />
                    ) : null}
                    <MultiCheckMenu
                        label="Queries"
                        placeholder="Select queries"
                        options={options.query}
                        value={draft.references.query}
                        onChange={(ids) => setReferences("query", ids)}
                    />
                    <MultiCheckMenu
                        label="Evaluators"
                        placeholder="Select evaluators"
                        options={options.evaluator}
                        value={draft.references.evaluator}
                        onChange={(ids) => setReferences("evaluator", ids)}
                    />
                    <MultiCheckMenu
                        label="Test sets"
                        placeholder="Select test sets"
                        options={options.testset}
                        value={draft.references.testset}
                        onChange={(ids) => setReferences("testset", ids)}
                    />
                    <MultiCheckMenu
                        label="Variants"
                        placeholder={appPicked ? "Select variants" : "Select an application first"}
                        options={options.variant}
                        value={draft.references.variant}
                        onChange={(ids) => setReferences("variant", ids)}
                        disabled={!appPicked}
                    />
                    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                        <span className="text-sm font-medium text-foreground">Date range</span>
                        <Select
                            value={draft.range ?? ALL_TIME}
                            onValueChange={(next) =>
                                setDraft((current) => ({
                                    ...current,
                                    range: RUN_DATE_RANGES.find((label) => label === next) ?? null,
                                }))
                            }
                        >
                            <SelectTrigger size="sm" aria-label="Date range">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_TIME}>All time</SelectItem>
                                {RUN_DATE_RANGES.map((label) => (
                                    <SelectItem key={label} value={label}>
                                        Last {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="mt-4 flex justify-end gap-2 border-0 border-t border-solid border-border pt-3">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft(EMPTY_RUN_FILTERS)}
                    >
                        Reset
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={!changed}
                        onClick={() => {
                            onApply(draft)
                            toggle(false)
                        }}
                    >
                        Apply
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
