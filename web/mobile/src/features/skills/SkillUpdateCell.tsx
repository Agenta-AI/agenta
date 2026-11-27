import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {Button, SimpleTooltip, Spinner} from "@agenta/ui/ui"
import {ArrowCircleUp, CheckCircle} from "@phosphor-icons/react"

import {useSkillUpdates, useSkillUpdateStatus} from "./useSkillUpdates"

/** Beside the kebab after a check: Update while one waits, a mark once applied. `compact` is the row's icon form. */
export const SkillUpdateCell = ({
    workflowId,
    compact = false,
}: {
    workflowId: string
    compact?: boolean
}) => {
    const t = useT(skillsListCatalog)
    const status = useSkillUpdateStatus(workflowId)
    const {apply} = useSkillUpdates()

    if (status === "checking")
        return (
            <span className="flex size-6 items-center justify-center">
                <Spinner size="small" className="text-muted-foreground" />
            </span>
        )
    if (status === "available")
        return compact ? (
            <SimpleTooltip title={t("skills.list.updateToLatest")}>
                <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("skills.list.updateToLatest")}
                    onClick={() => void apply([workflowId])}
                >
                    <ArrowCircleUp aria-hidden />
                </Button>
            </SimpleTooltip>
        ) : (
            <Button size="xs" variant="outline" onClick={() => void apply([workflowId])}>
                {t("skills.list.update")}
            </Button>
        )
    if (status === "updated")
        return compact ? (
            <SimpleTooltip title={t("skills.list.updated")}>
                <span className="flex size-6 items-center justify-center text-muted-foreground">
                    <CheckCircle aria-label={t("skills.list.updated")} className="size-4" />
                </span>
            </SimpleTooltip>
        ) : (
            <span className="text-meta text-muted-foreground">{t("skills.list.updated")}</span>
        )
    return null
}
