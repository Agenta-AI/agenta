import {useCallback, useState} from "react"

import {Pause, Play} from "@phosphor-icons/react"
import {Button, Tooltip, message} from "antd"

// ---------------------------------------------------------------------------
// ActiveToggle — shared play/pause control for the three lifecycle entities
// (trigger subscription, trigger schedule, webhook subscription). They all
// expose `flags.is_active`; the parent wires `onToggle` to the matching
// start/stop route (with optimistic cache update). This component only owns the
// in-flight spinner + error surfacing so each list/drawer reuses it verbatim.
// ---------------------------------------------------------------------------

export interface ActiveToggleProps {
    active: boolean
    onToggle: (next: boolean) => Promise<void>
    disabled?: boolean
    size?: "small" | "middle" | "large"
    /** Shown on success/failure; defaults are generic. */
    activatedMessage?: string
    pausedMessage?: string
    errorMessage?: string
}

export default function ActiveToggle({
    active,
    onToggle,
    disabled,
    size = "small",
    activatedMessage = "Activated",
    pausedMessage = "Paused",
    errorMessage = "Failed to update state",
}: ActiveToggleProps) {
    const [loading, setLoading] = useState(false)

    const handleClick = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation()
            const next = !active
            setLoading(true)
            try {
                await onToggle(next)
                message.success(next ? activatedMessage : pausedMessage)
            } catch {
                message.error(errorMessage)
            } finally {
                setLoading(false)
            }
        },
        [active, onToggle, activatedMessage, pausedMessage, errorMessage],
    )

    return (
        <Tooltip title={active ? "Pause" : "Resume"}>
            <Button
                type="text"
                size={size}
                loading={loading}
                disabled={disabled}
                aria-label={active ? "Pause" : "Resume"}
                aria-pressed={active}
                icon={active ? <Pause size={16} /> : <Play size={16} />}
                onClick={handleClick}
            />
        </Tooltip>
    )
}
