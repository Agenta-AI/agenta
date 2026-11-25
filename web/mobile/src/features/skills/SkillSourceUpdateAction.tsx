import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {LoadingButton} from "@agenta/ui/ui"
import {ArrowsClockwise} from "@phosphor-icons/react"

import {useSkillUpdates, useSkillUpdatesBusy, useSkillsWithUpdates} from "./useSkillUpdates"

/** A repository heading's action: "Check for updates", then "Update N skills" while any wait. */
export const SkillSourceUpdateAction = ({ids}: {ids: string[]}) => {
    const t = useT(skillsListCatalog)
    const {check, apply} = useSkillUpdates()
    const pending = useSkillsWithUpdates(ids)
    const busy = useSkillUpdatesBusy(ids)

    if (pending.length)
        return (
            <LoadingButton
                size="xs"
                variant="outline"
                loading={busy}
                disabled={busy}
                onClick={() => void apply(pending)}
            >
                {t("skills.list.updateSkills", {count: pending.length})}
            </LoadingButton>
        )

    return (
        <LoadingButton
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            loading={busy}
            disabled={busy}
            onClick={() => void check(ids)}
        >
            {busy ? null : <ArrowsClockwise aria-hidden size={12} />}
            {t("skills.list.checkUpdates")}
        </LoadingButton>
    )
}
