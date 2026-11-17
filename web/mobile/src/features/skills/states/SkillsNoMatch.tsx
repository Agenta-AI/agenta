import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
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
}) => {
    const t = useT(skillsListCatalog)
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
                <EmptyTitle>
                    {term ? t("skills.list.noMatchTerm", {term}) : t("skills.list.noMatchFilters")}
                </EmptyTitle>
                <EmptyDescription>
                    {term ? t("skills.list.noMatchTermBody") : t("skills.list.noMatchFiltersBody")}
                </EmptyDescription>
            </EmptyHeader>
            {onClear ? (
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={onClear}>
                        {term ? t("skills.list.clearSearch") : t("skills.list.clearFilters")}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}
