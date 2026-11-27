import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {ArchiveIcon, MagnifyingGlassIcon} from "@phosphor-icons/react"

/** No archived apps, or none that match the search; offers the way back from a search. */
export const ArchivedAppsEmpty = ({term, onClear}: {term?: string; onClear?: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                {term ? <MagnifyingGlassIcon /> : <ArchiveIcon />}
            </EmptyMedia>
            <EmptyTitle>
                {term ? `No archived prompts match “${term}”` : "No archived prompts"}
            </EmptyTitle>
        </EmptyHeader>
        {term && onClear ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    Clear search
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
