import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowCircleUp, CheckCircle} from "@phosphor-icons/react"

import {useSkillUpdates, useSkillUpdateStatus} from "./useSkillUpdates"

/**
 * What a row or a card says beside its kebab once someone checked upstream: an Update control
 * while one is waiting, a mark once it landed, nothing otherwise. Reads the shared answer, so
 * the group heading's count and this control can never disagree.
 *
 * `compact` is the row's form — an icon at the kebab's own size, so the actions column stays one
 * width whether or not a row has something to update. A card has room for the word.
 */
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
            <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("skills.list.updateToLatest")}
                title={t("skills.list.updateToLatest")}
                className="text-primary hover:bg-foreground/10 dark:hover:bg-foreground/15"
                onClick={() => void apply([workflowId])}
            >
                <ArrowCircleUp aria-hidden className="size-4" weight="fill" />
            </Button>
        ) : (
            <button
                type="button"
                title="Update to the latest version"
                onClick={(event) => {
                    event.stopPropagation()
                    void apply([workflowId])
                }}
                className="relative z-[1] inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-[inherit] text-[13px] text-tag-orange"
            >
                <span aria-hidden className="size-1.5 rounded-full bg-tag-orange" />
                Update available
            </button>
        )
    if (status === "updated")
        return compact ? (
            <span
                className="flex size-6 items-center justify-center text-muted-foreground"
                title={t("skills.list.updated")}
            >
                <CheckCircle aria-label={t("skills.list.updated")} className="size-4" />
            </span>
        ) : (
            <span className="text-[12px] text-muted-foreground">{t("skills.list.updated")}</span>
        )
    return null
}
