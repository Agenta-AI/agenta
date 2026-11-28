import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

/** The project has runs, but the search or the status filter hid all of them. */
export const EvaluationsNoMatch = ({onClear}: {onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <MagnifyingGlassIcon />
            </EmptyMedia>
            <EmptyTitle>No evaluations match your filters</EmptyTitle>
            <EmptyDescription>Try a shorter search or fewer statuses.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear filters
            </Button>
        </EmptyContent>
    </Empty>
)
