import {useCallback, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {message} from "@agenta/ui/app-message"
import {Switch} from "@agenta/ui/ui"

import {cn} from "./lib/utils"

const tNow = createT(automationsEditorCatalog)

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
    const t = useT(automationsEditorCatalog)
    const [saving, setSaving] = useState(false)

    const toggle = useCallback(
        async (next: boolean) => {
            if (saving) return
            setSaving(true)
            try {
                await onToggle(next)
                message.success(
                    next
                        ? tNow("automations.editor.switchedOn")
                        : tNow("automations.editor.switchedOff"),
                )
            } catch {
                message.error(tNow("automations.editor.changeFailed"))
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
                aria-label={
                    active
                        ? t("automations.editor.switchOffAria")
                        : t("automations.editor.switchOnAria")
                }
            />
            {label ? (
                <span className="text-[14px] text-foreground">
                    {active ? t("automations.editor.on") : t("automations.editor.off")}
                </span>
            ) : null}
        </span>
    )
}
