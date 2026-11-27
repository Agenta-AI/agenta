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
import {ArchiveIcon, FunnelIcon, MagnifyingGlassIcon} from "@phosphor-icons/react"

/** The project has agents, but the search or filters hid them; offers the way back. */
export const AgentsNoMatch = ({
    term,
    onClear,
    archiveEmpty = false,
    onShowActive,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
    /** The archive view with nothing archived: says so instead of blaming the filters. */
    archiveEmpty?: boolean
    onShowActive?: () => void
}) => {
    const t = useT(agentsList)
    if (archiveEmpty) {
        return (
            <Empty className="py-14">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ArchiveIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t("agents.list.noArchivedTitle")}</EmptyTitle>
                    <EmptyDescription>{t("agents.list.noArchivedBody")}</EmptyDescription>
                </EmptyHeader>
                {onShowActive ? (
                    <EmptyContent>
                        <Button size="sm" variant="outline" onClick={onShowActive}>
                            {t("agents.list.backToActive")}
                        </Button>
                    </EmptyContent>
                ) : null}
            </Empty>
        )
    }
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    {term ? <MagnifyingGlassIcon /> : <FunnelIcon />}
                </EmptyMedia>
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
