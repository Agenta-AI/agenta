/** The schedule drawer's footer run-in-playground CTA (simulates a scheduled tick). */
import {useCallback, useMemo, useRef, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import triggerScheduleCatalog from "@agenta/i18n/catalogs/entityUi.triggerSchedule"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {
    Button,
    Popover,
    PopoverAnchor,
    PopoverContent,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {Play} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

// ---------------------------------------------------------------------------
// RunInPlaygroundButton — the persistent footer CTA (playground only). A cron
// has no external event to wait for: its payload is the static inputs. So this
// simulates a scheduled tick, channelling the resolved inputs into the agent's
// chat session (no save, no waiting). A popover previews what the agent gets.
// ---------------------------------------------------------------------------


// The error toast fires from a handler, outside render.
const tNow = createT(triggerScheduleCatalog)

export function RunInPlaygroundButton({
    playgroundEntityId,
    name,
    cron,
    inputsText,
    message: composedMessage,
    disabled,
    onClose,
}: {
    playgroundEntityId: string
    name: string
    cron: string
    inputsText: string
    message: string
    disabled?: boolean
    onClose: () => void
}) {
    const t = useT(triggerScheduleCatalog)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId))

    const parsed = useMemo<{ok: boolean; value: Record<string, unknown>}>(() => {
        try {
            return {ok: true, value: inputsText.trim() ? JSON.parse(inputsText) : {}}
        } catch {
            return {ok: false, value: {}}
        }
    }, [inputsText])

    const preview = useMemo(() => {
        // Prefer the composed message (sent as the agent's user message); otherwise
        // fall back to a JSON dump of the raw inputs.
        if (composedMessage.trim()) return composedMessage
        const label = name || "Scheduled run"
        return `[Scheduled run · ${label} (${cron})]\n\`\`\`json\n${JSON.stringify(parsed.value, null, 2)}\n\`\`\``
    }, [composedMessage, name, cron, parsed])

    const handleRun = useCallback(() => {
        if (!parsed.ok) {
            message.error(tNow("entityUi.triggerSchedule.inputsNotValidJson"))
            return
        }
        setPendingRun({text: preview, nonce: Date.now(), newSession: true})
        onClose()
    }, [parsed.ok, preview, setPendingRun, onClose])

    // Radix Popover has no hover trigger — antd's `trigger="hover"` is reproduced with
    // manual enter/leave timers on the anchor AND the content (antd keeps the popover
    // open while the pointer is over it; 100ms ≈ antd's mouseEnter/LeaveDelay of 0.1s).
    const [open, setOpen] = useState(false)
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const hover = useCallback((next: boolean) => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => setOpen(next), 100)
    }, [])

    if (disabled) {
        // A draft can't be tested until it exists as a saved schedule.
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>
                            <Button variant="outline" disabled>
                                <Play size={14} />
                                {t("entityUi.triggerSchedule.runInPlayground")}
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t("entityUi.triggerSchedule.createScheduleFirst")}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <Button
                    variant="outline"
                    onClick={handleRun}
                    onMouseEnter={() => hover(true)}
                    onMouseLeave={() => hover(false)}
                >
                    <Play size={14} />
                    {t("entityUi.triggerSchedule.runInPlayground")}
                </Button>
            </PopoverAnchor>
            <PopoverContent
                side="top"
                align="end"
                className="p-3"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onMouseEnter={() => hover(true)}
                onMouseLeave={() => hover(false)}
            >
                {/* antd Popover `title`: label row above the content. */}
                <div className="mb-2 text-xs font-medium text-[var(--ag-colorTextHeading)]">
                    {t("entityUi.triggerSchedule.agentWillReceive")}
                </div>
                <pre className="m-0 max-h-[240px] max-w-[320px] overflow-auto whitespace-pre-wrap break-words text-xs leading-snug">
                    {parsed.ok ? preview : t("entityUi.triggerSchedule.inputsNotValidJsonSentence")}
                </pre>
            </PopoverContent>
        </Popover>
    )
}
