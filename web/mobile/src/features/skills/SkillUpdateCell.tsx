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
export const SkillUpdateCell = ({workflowId, compact = false}: {workflowId: string; compact?: boolean}) => {
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
                aria-label="Update to the latest version"
                title="Update to the latest version"
                className="text-primary hover:bg-foreground/10 dark:hover:bg-foreground/15"
                onClick={() => void apply([workflowId])}
            >
                <ArrowCircleUp aria-hidden className="size-4" weight="fill" />
            </Button>
        ) : (
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11.5px] font-normal"
                onClick={() => void apply([workflowId])}
            >
                Update
            </Button>
        )
    if (status === "updated")
        return compact ? (
            <span className="flex size-6 items-center justify-center text-muted-foreground" title="Updated">
                <CheckCircle aria-label="Updated" className="size-4" />
            </span>
        ) : (
            <span className="text-[12px] text-muted-foreground">Updated</span>
        )
    return null
}
