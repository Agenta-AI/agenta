import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {LoadingButton} from "@agenta/ui/ui"
import {ArrowsClockwise} from "@phosphor-icons/react"

import {useSkillUpdates, useSkillUpdatesBusy, useSkillsWithUpdates} from "./useSkillUpdates"

/**
 * A repository group's action, at its heading's right edge: "Check for updates" until someone asks,
 * then "Update N skills" for as long as any are waiting.
 *
 * Check-first because the check is read-only and the apply is not — a heading that said
 * "Update 4 skills" before anyone looked would be promising work it had not measured.
 */
export const SkillSourceUpdateAction = ({ids}: {ids: string[]}) => {
    const t = useT(skillsListCatalog)
    const {check, apply} = useSkillUpdates()
    const pending = useSkillsWithUpdates(ids)
    const busy = useSkillUpdatesBusy(ids)

    // One button through a check or an update; the spinner takes the icon's place while busy.
    if (pending.length)
        return (
            <LoadingButton
                size="xs"
                variant="outline"
                loading={busy}
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
            onClick={() => void check(ids)}
        >
            {busy ? null : <ArrowsClockwise aria-hidden size={12} />}
            {t("skills.list.checkUpdates")}
        </LoadingButton>
    )
}
