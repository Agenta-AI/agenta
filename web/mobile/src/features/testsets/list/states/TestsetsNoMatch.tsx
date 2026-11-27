import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

/**
 * The project has testsets, but the search or the date filter hid them all. Offers the way back:
 * the clear button removes both.
 */
export const TestsetsNoMatch = ({
    term,
    filtered = false,
    onClear,
}: {
    term: string
    /** A date filter is on too. */
    filtered?: boolean
    onClear: () => void
}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <MagnifyingGlassIcon />
            </EmptyMedia>
            <EmptyTitle className="text-foreground">
                {term ? `No test sets match “${term}”` : "No test sets match this filter"}
            </EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                {term && filtered
                    ? "Clear search and filter"
                    : term
                      ? "Clear search"
                      : "Clear filter"}
            </Button>
        </EmptyContent>
    </Empty>
)
