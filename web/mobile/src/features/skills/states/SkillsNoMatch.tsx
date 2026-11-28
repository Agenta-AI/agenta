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
import {ArchiveIcon, FunnelIcon, MagnifyingGlassIcon} from "@phosphor-icons/react"

/** The project has skills, but the search or filters hid them; offers the way back. */
export const SkillsNoMatch = ({
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
    const t = useT(skillsListCatalog)
    if (archiveEmpty) {
        return (
            <Empty className="py-10">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ArchiveIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t("skills.list.noArchivedTitle")}</EmptyTitle>
                    <EmptyDescription>{t("skills.list.noArchivedBody")}</EmptyDescription>
                </EmptyHeader>
                {onShowActive ? (
                    <EmptyContent>
                        <Button size="sm" variant="outline" onClick={onShowActive}>
                            {t("skills.list.backToActive")}
                        </Button>
                    </EmptyContent>
                ) : null}
            </Empty>
        )
    }
    return (
        <Empty className="py-10">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    {term ? <MagnifyingGlassIcon /> : <FunnelIcon />}
                </EmptyMedia>
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
