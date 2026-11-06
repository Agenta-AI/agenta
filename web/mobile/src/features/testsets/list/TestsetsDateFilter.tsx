import {useMemo} from "react"

import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {Button} from "@agenta/ui/ui"
import {CalendarBlank, X} from "@phosphor-icons/react"

import {
    CREATED_RANGES,
    createdFilterFor,
    createdRangeLabel,
    type TestsetCreatedFilter,
    type TestsetCreatedRange,
} from "./testsetCreatedRange"

const ICON = 14

/**
 * The list's filter button and, beside it, what it narrows the list to: the Date Created quick
 * ranges, as the old app offers them. "No filters applied" when the list is not narrowed, and the
 * active range with a clear button otherwise, so missing rows always have a visible reason.
 */
export const TestsetsDateFilter = ({
    filter,
    onChange,
}: {
    filter: TestsetCreatedFilter | null
    onChange: (next: TestsetCreatedFilter | null) => void
}) => {
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "created",
                label: "Date Created",
                icon: <CalendarBlank size={ICON} />,
                value: filter?.range ?? "all",
                options: CREATED_RANGES.map((range) => ({value: range.value, label: range.label})),
                onChange: (value) =>
                    onChange(createdFilterFor(value as TestsetCreatedRange, new Date())),
            },
        ],
        [filter?.range, onChange],
    )

    return (
        <>
            <FilterMenu
                sections={sections}
                searchable={false}
                align="start"
                label={null}
                triggerAriaLabel="Filters"
                size="default"
                // The square icon size is 28; the search field beside it is 32.
                triggerClassName="size-8"
                active={filter !== null}
                onReset={() => onChange(null)}
                resetDisabled={filter === null}
            />
            {filter ? (
                <span className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
                    <span className="truncate">
                        Date Created: {createdRangeLabel(filter.range)}
                    </span>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Clear the date filter"
                        onClick={() => onChange(null)}
                    >
                        <X aria-hidden size={12} />
                    </Button>
                </span>
            ) : (
                <span className="truncate text-[13px] text-placeholder max-sm:hidden">
                    No filters applied
                </span>
            )}
        </>
    )
}
