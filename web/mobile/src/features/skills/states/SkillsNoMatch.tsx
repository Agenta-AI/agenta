import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Filter, Search} from "lucide-react"

/** The project has skills, but the search or filters hid them; offers the way back. */
export const SkillsNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
            <EmptyTitle>
                {term ? `Nothing matches “${term}”` : "No skills match these filters"}
            </EmptyTitle>
            <EmptyDescription>
                {term
                    ? "Try a shorter search, or check the filters — they narrow this list too."
                    : "Try widening the filters, or including archived skills."}
            </EmptyDescription>
        </EmptyHeader>
        {onClear ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    {term ? "Clear search" : "Clear filters"}
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
