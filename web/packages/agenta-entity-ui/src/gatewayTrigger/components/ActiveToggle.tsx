import {useCallback, useState} from "react"

import {message} from "@agenta/ui"
import {
    LoadingButton,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    type ButtonProps,
} from "@agenta/ui/ui"
import {Pause, Play} from "@phosphor-icons/react"

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
    size?: ButtonProps["size"]
    /** Shown on success/failure; defaults are generic. */
    activatedMessage?: string
    pausedMessage?: string
    errorMessage?: string
}

export default function ActiveToggle({
    active,
    onToggle,
    disabled,
    size = "icon-sm",
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
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <LoadingButton
                        variant="ghost"
                        size={size}
                        loading={loading}
                        disabled={disabled}
                        aria-label={active ? "Pause" : "Resume"}
                        aria-pressed={active}
                        onClick={handleClick}
                    >
                        {loading ? null : active ? <Pause size={14} /> : <Play size={14} />}
                    </LoadingButton>
                </TooltipTrigger>
                <TooltipContent>{active ? "Pause" : "Resume"}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
