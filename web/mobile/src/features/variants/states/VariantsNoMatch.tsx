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

/** The app has revisions, but the search hid all of them. */
export const VariantsNoMatch = ({term, onClear}: {term: string; onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <MagnifyingGlassIcon />
            </EmptyMedia>
            <EmptyTitle>No revisions match “{term}”</EmptyTitle>
            <EmptyDescription>Try a shorter search.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear search
            </Button>
        </EmptyContent>
    </Empty>
)
