import {useT} from "@agenta/i18n"
import agentsList from "@agenta/i18n/catalogs/agents.list"
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

/** The project has agents, but the search or filters hid them; offers the way back. */
export const AgentsNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => {
    const t = useT(agentsList)
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
                <EmptyTitle>
                    {term
                        ? t("agents.list.noMatchSearchTitle", {term})
                        : t("agents.list.noMatchFiltersTitle")}
                </EmptyTitle>
                <EmptyDescription>
                    {term
                        ? t("agents.list.noMatchSearchBody")
                        : t("agents.list.noMatchFiltersBody")}
                </EmptyDescription>
            </EmptyHeader>
            {onClear ? (
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={onClear}>
                        {term ? t("agents.list.clearSearch") : t("agents.list.clearFilters")}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}
