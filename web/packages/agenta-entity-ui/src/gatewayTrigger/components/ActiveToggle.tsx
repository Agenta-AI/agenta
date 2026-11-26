import {useCallback, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import triggerSharedCatalog from "@agenta/i18n/catalogs/entityUi.triggerShared"
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

// The toasts fire from a callback, so their default text translates at call time.
const tNow = createT(triggerSharedCatalog)

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
    activatedMessage,
    pausedMessage,
    errorMessage,
}: ActiveToggleProps) {
    const t = useT(triggerSharedCatalog)
    const [loading, setLoading] = useState(false)

    const handleClick = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation()
            const next = !active
            setLoading(true)
            try {
                await onToggle(next)
                message.success(
                    next
                        ? (activatedMessage ?? tNow("entityUi.triggerShared.activated"))
                        : (pausedMessage ?? tNow("entityUi.triggerShared.paused")),
                )
            } catch {
                message.error(errorMessage ?? tNow("entityUi.triggerShared.failedToUpdateState"))
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
                        aria-label={
                            active
                                ? t("entityUi.triggerShared.pause")
                                : t("entityUi.triggerShared.resume")
                        }
                        aria-pressed={active}
                        onClick={handleClick}
                    >
                        {loading ? null : active ? <Pause size={14} /> : <Play size={14} />}
                    </LoadingButton>
                </TooltipTrigger>
                <TooltipContent>
                    {active
                        ? t("entityUi.triggerShared.pause")
                        : t("entityUi.triggerShared.resume")}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
