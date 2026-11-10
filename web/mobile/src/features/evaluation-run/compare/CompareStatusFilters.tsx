import {COMPARE_STATUS_FILTERS, type CompareStatusFilter} from "@agenta/entities/evaluationRun"
import {Button} from "@agenta/ui/ui"

/** The picker's status filters, each with the number of runs it keeps. */
export const CompareStatusFilters = ({
    value,
    counts,
    onChange,
}: {
    value: CompareStatusFilter
    counts: Record<CompareStatusFilter, number>
    onChange: (value: CompareStatusFilter) => void
}) => (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
        <span className="text-xs text-muted-foreground">Filters:</span>
        {COMPARE_STATUS_FILTERS.map((filter) => (
            <Button
                key={filter.key}
                size="xs"
                variant={value === filter.key ? "default" : "outline"}
                aria-pressed={value === filter.key}
                onClick={() => onChange(filter.key)}
            >
                {`${filter.label} (${counts[filter.key]})`}
            </Button>
        ))}
    </div>
)
