import {Button} from "@agenta/ui/ui"
import {XIcon} from "@phosphor-icons/react"

import {
    RUN_STATUS_OPTIONS,
    RUN_TYPE_OPTIONS,
    type ReferenceFilterKey,
    type RunFilterValues,
} from "./useEvaluationRunsFilters"
import type {FilterOption} from "./useRunFilterOptions"

const REFERENCE_LABELS: Record<ReferenceFilterKey, string> = {
    evaluator: "Evaluators",
    testset: "Test sets",
    query: "Queries",
    variant: "Variants",
}

const labelsOf = (options: readonly FilterOption[], ids: readonly string[]) =>
    ids.map((id) => options.find((option) => option.value === id)?.label ?? id).join(", ")

/**
 * The applied filters as chips next to the Filters button, as in the old app. Each chip removes
 * its own filter.
 */
export const RunFilterChips = ({
    value,
    options,
    onChange,
}: {
    value: RunFilterValues
    options: Record<ReferenceFilterKey, FilterOption[]>
    onChange: (next: RunFilterValues) => void
}) => {
    const chips: {key: string; label: string; text: string; clear: () => RunFilterValues}[] = []
    if (value.statuses.length > 0) {
        chips.push({
            key: "status",
            label: "Status",
            text: labelsOf(RUN_STATUS_OPTIONS, value.statuses),
            clear: () => ({...value, statuses: []}),
        })
    }
    if (value.types.length > 0) {
        chips.push({
            key: "types",
            label: "Type",
            text: labelsOf(RUN_TYPE_OPTIONS, value.types),
            clear: () => ({...value, types: []}),
        })
    }
    for (const key of Object.keys(REFERENCE_LABELS) as ReferenceFilterKey[]) {
        if (value.references[key].length === 0) continue
        chips.push({
            key,
            label: REFERENCE_LABELS[key],
            text: labelsOf(options[key], value.references[key]),
            clear: () => ({...value, references: {...value.references, [key]: []}}),
        })
    }
    if (value.range) {
        chips.push({
            key: "range",
            label: "Date range",
            text: `Last ${value.range}`,
            clear: () => ({...value, range: null}),
        })
    }
    if (chips.length === 0) {
        return <span className="text-xs text-muted-foreground">No filters applied</span>
    }
    return (
        <ul
            aria-label="Applied filters"
            className="m-0 flex list-none flex-wrap items-center gap-1 p-0"
        >
            {chips.map((chip) => (
                <li
                    key={chip.key}
                    className="flex min-w-0 max-w-[280px] items-center gap-1 rounded-md border border-solid border-border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
                >
                    <span className="truncate">
                        <span className="text-muted-foreground">{chip.label}: </span>
                        {chip.text}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${chip.label} filter`}
                        className="size-5 shrink-0"
                        onClick={() => onChange(chip.clear())}
                    >
                        <XIcon aria-hidden size={10} />
                    </Button>
                </li>
            ))}
        </ul>
    )
}
