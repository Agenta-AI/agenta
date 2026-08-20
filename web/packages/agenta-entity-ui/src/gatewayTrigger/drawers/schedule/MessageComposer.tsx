/** The schedule drawer's "Message" field — what the agent is told on each run. */
import {getScheduleMessage, setScheduleMessage} from "@agenta/entities/gatewayTrigger"
import {AutosizeTextarea} from "@agenta/ui/ui"

// ---------------------------------------------------------------------------
// MessageComposer — one message, mapped onto the agent's primary input (`messages` for chat
// agents, else a schema string input). The raw-JSON editor this field used to carry is gone,
// so a mapping richer than a single message can no longer be edited here; the warning below is
// the only thing between such a mapping and a silent overwrite.
// ---------------------------------------------------------------------------

export function MessageComposer({
    inputsText,
    onChange,
    isChat,
    primaryKey,
    disabled,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    disabled?: boolean
}) {
    const message = getScheduleMessage(inputsText, isChat, primaryKey)
    // The composer writes a single user message, so anything richer would be lost on edit.
    const wouldReplace = !message && !!inputsText.trim() && inputsText.trim() !== "{}"

    return (
        <div className="flex flex-col gap-1.5">
            <AutosizeTextarea
                placeholder="Summarize yesterday's support tickets and post the digest to #ops."
                value={message}
                onChange={(e) =>
                    onChange(setScheduleMessage(inputsText, e.target.value, isChat, primaryKey))
                }
                autoSize={{minRows: 3, maxRows: 8}}
                disabled={disabled}
            />
            <span
                className={`text-xs leading-snug ${
                    wouldReplace
                        ? "text-[var(--ag-colorWarningText)]"
                        : "text-[var(--ag-colorTextDescription)]"
                }`}
            >
                {wouldReplace ? (
                    "This schedule sends a richer set of inputs than one message — typing here replaces them."
                ) : (
                    <>
                        Sent to the agent{" "}
                        {isChat ? "as the user message" : `as the "${primaryKey}" input`} on each
                        run.
                    </>
                )}
            </span>
        </div>
    )
}
