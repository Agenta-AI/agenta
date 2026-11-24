import {useState} from "react"

import {Switch} from "@agenta/ui/ui"
import {CircleNotchIcon} from "@phosphor-icons/react"

const SERVER_MS = 900

/** MICRO-05: an automation's switch flips on the click, or waits for the server first. */
export function OptimisticToggleDemo({optimistic}: {optimistic: boolean}) {
    const [on, setOn] = useState(false)
    const [saving, setSaving] = useState(false)
    const toggle = (next: boolean) => {
        if (optimistic) {
            setOn(next)
            return
        }
        setSaving(true)
        setTimeout(() => {
            setOn(next)
            setSaving(false)
        }, SERVER_MS)
    }
    return (
        <div className="flex w-full max-w-64 items-center justify-between rounded-md bg-background px-3 py-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
            <div className="flex flex-col">
                <span className="text-label">Daily digest</span>
                <span className="text-meta text-muted-foreground">
                    {on ? "Runs every day at 9:00" : "Paused"}
                </span>
            </div>
            <div className="flex items-center gap-2">
                {saving ? (
                    <CircleNotchIcon className="size-4 animate-spin text-muted-foreground" />
                ) : null}
                <Switch
                    checked={on}
                    disabled={saving}
                    onCheckedChange={toggle}
                    aria-label="Run this automation"
                />
            </div>
        </div>
    )
}
