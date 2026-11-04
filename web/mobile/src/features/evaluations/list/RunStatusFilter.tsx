import {
    Button,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Funnel} from "@phosphor-icons/react"

import {RUN_STATUS_OPTIONS} from "./useEvaluationRunsFilters"

/** A multi select over the run statuses. An empty selection means every status. */
export const RunStatusFilter = ({
    value,
    onChange,
}: {
    value: readonly string[]
    onChange: (next: string[]) => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label="Filter by status">
                <Funnel aria-hidden size={14} />
                {/* A phone has no room for the word until a status is picked. */}
                <span className={value.length > 0 ? undefined : "hidden sm:inline"}>
                    {value.length > 0 ? `Status (${value.length})` : "Status"}
                </span>
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[180px]">
            {RUN_STATUS_OPTIONS.map((option) => (
                <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={value.includes(option.value)}
                    // Keep the menu open so several statuses can be picked in one go.
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                        onChange(
                            checked
                                ? [...value, option.value]
                                : value.filter((entry) => entry !== option.value),
                        )
                    }
                >
                    {option.label}
                </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuContent>
    </DropdownMenu>
)
