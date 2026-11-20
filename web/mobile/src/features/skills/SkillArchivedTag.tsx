import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"

/** The Archived tag a row and a card both wear, so the two views mark a put-away skill alike. */
export const SkillArchivedTag = () => {
    const t = useT(skillsListCatalog)
    return (
        <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] leading-4 text-muted-foreground">
            {t("skills.list.archivedTag")}
        </span>
    )
}
