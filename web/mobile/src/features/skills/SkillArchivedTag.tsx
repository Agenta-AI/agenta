import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {Badge} from "@agenta/ui/ui"

/** The Archived tag a row and a card both wear, so the two views mark a put-away skill alike. */
export const SkillArchivedTag = () => {
    const t = useT(skillsListCatalog)
    return <Badge className="shrink-0">{t("skills.list.archivedTag")}</Badge>
}
