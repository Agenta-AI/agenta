import {useCallback, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Switch} from "@agenta/ui/ui"

import {cn} from "./lib/utils"

/**
 * The automation's on/off switch, with the pending guard and the messages it owns.
 *
 * A switch rather than the shared `ActiveToggle`: it states whether the automation is on, and
 * shows that at rest. `ActiveToggle` is a play/pause button, which reads as the action rather
 * than the state — right in a row of row-actions, wrong as a status.
 */
export const AutomationActiveSwitch = ({
    active,
    onToggle,
    label = true,
    className,
}: {
    active: boolean
    onToggle: (next: boolean) => Promise<void>
    /** "On" / "Off" beside the switch. Off where the switch sits among icon buttons. */
    label?: boolean
    className?: string
}) => {
    const [saving, setSaving] = useState(false)

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
        // The switch and its label are one control, so they sit closer than the 14px that
        // separates them from the rest of the line.
        <span className={cn("flex shrink-0 items-center gap-[9px]", className)}>
            <Switch
                size="sm"
                checked={active}
                disabled={saving}
                onCheckedChange={(next) => void toggle(next)}
                aria-label={active ? "Switch this automation off" : "Switch this automation on"}
            />
            {label ? (
                <span className="text-[14px] text-foreground">{active ? "On" : "Off"}</span>
            ) : null}
        </span>
    )
}
