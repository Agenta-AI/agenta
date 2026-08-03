/** The schedule drawer's footer run-in-playground CTA (simulates a scheduled tick). */
import {useCallback, useMemo} from "react"

import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {Play} from "@phosphor-icons/react"
import {Button, Popover, Tooltip} from "antd"
import {useSetAtom} from "jotai"

// ---------------------------------------------------------------------------
// RunInPlaygroundButton — the persistent footer CTA (playground only). A cron
// has no external event to wait for: its payload is the static inputs. So this
// simulates a scheduled tick, channelling the resolved inputs into the agent's
// chat session (no save, no waiting). A popover previews what the agent gets.
// ---------------------------------------------------------------------------

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
            message.error("Inputs is not valid JSON")
            return
        }
        setPendingRun({text: preview, nonce: Date.now(), newSession: true})
        onClose()
    }, [parsed.ok, preview, setPendingRun, onClose])

    if (disabled) {
        // A draft can't be tested until it exists as a saved schedule.
        return (
            <Tooltip title="Create the schedule first to run it">
                <span>
                    <Button icon={<Play size={14} />} disabled>
                        Run in playground
                    </Button>
                </span>
            </Tooltip>
        )
    }

    return (
        <Popover
            placement="topRight"
            title="Agent will receive"
            content={
                <pre className="m-0 max-h-[240px] max-w-[320px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug">
                    {parsed.ok ? preview : "Inputs is not valid JSON."}
                </pre>
            }
        >
            <Button icon={<Play size={14} />} onClick={handleRun}>
                Run in playground
            </Button>
        </Popover>
    )
}
