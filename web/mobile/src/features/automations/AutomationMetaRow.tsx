import {useCallback, useState} from "react"

import {timeAgo} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {Switch} from "@agenta/ui/ui"

/**
 * The facts under the name: on/off, then what it runs and when it last changed.
 *
 * A switch rather than the shared `ActiveToggle`: this row states whether the automation is on,
 * and a switch shows that at rest. `ActiveToggle` is a play/pause button, which reads as the
 * action rather than the state — right in a row of row-actions, wrong as a status line. The
 * pending guard and the messages it owned are kept here.
 *
 * No owner clause — the trigger endpoints carry only a `created_by_id`, and there is no user
 * lookup in this stack to turn that into a name, so the line stops at the agent.
 */
export const AutomationMetaRow = ({
    active,
    agentName,
    updatedAt,
    onToggle,
}: {
    active: boolean
    agentName: string | null
    updatedAt: string | null
    onToggle: (next: boolean) => Promise<void>
}) => {
    const [saving, setSaving] = useState(false)
    const edited = updatedAt ? timeAgo(Date.parse(updatedAt)) : ""

    const toggle = useCallback(
        async (next: boolean) => {
            if (saving) return
            setSaving(true)
            try {
                await onToggle(next)
                message.success(next ? "Automation switched on" : "Automation switched off")
            } catch {
                message.error("Couldn't change this automation")
            } finally {
                setSaving(false)
            }
        },
        [onToggle, saving],
    )

    return (
        <div className="mb-1 mt-4 flex min-w-0 flex-wrap items-center gap-3.5">
            {/* The switch and its label are one control, so they sit closer than the 14px that
                separates them from the rest of the line. */}
            <span className="flex shrink-0 items-center gap-[9px]">
                <Switch
                    size="sm"
                    checked={active}
                    disabled={saving}
                    onCheckedChange={(next) => void toggle(next)}
                    aria-label={
                        active ? "Switch this automation off" : "Switch this automation on"
                    }
                />
                <span className="text-[14px] text-foreground">{active ? "On" : "Off"}</span>
            </span>
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                {agentName ? `Runs ${agentName}` : "No agent yet"}
                {edited ? ` · edited ${edited}` : ""}
            </span>
        </div>
    )
}
