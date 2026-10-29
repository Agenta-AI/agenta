import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowsClockwise} from "@phosphor-icons/react"

import {useSkillUpdates, useSkillUpdatesBusy, useSkillsWithUpdates} from "./useSkillUpdates"

/**
 * A repository group's action, at its heading's right edge: "Check updates" until someone asks,
 * then "Update N skills" for as long as any are waiting.
 *
 * Check-first because the check is read-only and the apply is not — a heading that said
 * "Update 4 skills" before anyone looked would be promising work it had not measured.
 */
export const SkillSourceUpdateAction = ({ids}: {ids: string[]}) => {
    const {check, apply} = useSkillUpdates()
    const pending = useSkillsWithUpdates(ids)
    const busy = useSkillUpdatesBusy(ids)

    if (busy)
        return (
            <span className="flex h-6 items-center px-1.5">
                <Spinner size="small" className="text-muted-foreground" />
            </span>
        )

    if (pending.length)
        return (
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11.5px] font-normal"
                onClick={() => void apply(pending)}
            >
                Update {pending.length} {pending.length === 1 ? "skill" : "skills"}
            </Button>
        )

    return (
        <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[11.5px] font-normal text-muted-foreground"
            onClick={() => void check(ids)}
        >
            <ArrowsClockwise aria-hidden size={12} />
            Check updates
        </Button>
    )
}
