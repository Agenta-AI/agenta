import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

/** No template in the tab matches the search; offers the way back. */
export const EvaluatorTemplatesNoMatch = ({term, onClear}: {term: string; onClear: () => void}) => (
    <Empty className="py-10">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <MagnifyingGlassIcon />
            </EmptyMedia>
            <EmptyTitle>{term ? `No templates match “${term}”` : "No templates here"}</EmptyTitle>
        </EmptyHeader>
        {term ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    Clear search
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
