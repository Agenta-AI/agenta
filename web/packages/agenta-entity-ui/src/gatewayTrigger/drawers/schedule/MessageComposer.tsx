/** The schedule drawer's "What should the agent do?" message / raw-JSON editor. */
import {useMemo, useState} from "react"

import {getScheduleMessage, setScheduleMessage} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {AutosizeTextarea} from "@agenta/ui/ui"

// ---------------------------------------------------------------------------
// MessageComposer — friendly "what should the agent do?" message that maps to the
// agent's primary input (`messages` for chat agents, else a schema string input).
// "Advanced — raw JSON" swaps to a JSON editor over the full `inputs_fields`; only
// one editor is mounted at a time so the message and JSON never desync. Always opens
// on the message — a mapping the composer can't reproduce warns instead of switching.
// ---------------------------------------------------------------------------

const LINK_CLASS =
    "cursor-pointer border-0 bg-transparent p-0 text-btn-link hover:text-btn-link-hover active:text-btn-link-active"

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
    // Always opens on the message; raw JSON is opt-in via "Advanced" below.
    const [rawMode, setRawMode] = useState(false)

    const rawValid = useMemo(() => {
        const t = inputsText.trim()
        if (!t) return true
        try {
            JSON.parse(t)
            return true
        } catch {
            return false
        }
    }, [inputsText])

    if (rawMode) {
        return (
            <div className="flex flex-col gap-1.5">
                <button
                    type="button"
                    className={`${LINK_CLASS} self-start text-xs`}
                    onClick={() => setRawMode(false)}
                >
                    ← Back to message
                </button>
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={inputsText || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 120}}
                        disabled={disabled}
                    />
                </div>
                <span
                    className={`text-xs leading-snug ${
                        rawValid
                            ? "text-[var(--ag-colorTextDescription)]"
                            : "text-[var(--ag-colorErrorText)]"
                    }`}
                >
                    {rawValid
                        ? "Raw inputs sent to the workflow each tick (JSON)."
                        : "Invalid JSON."}
                </span>
            </div>
        )
    }

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
                autoSize={{minRows: 2, maxRows: 6}}
                disabled={disabled}
            />
            <div className="flex items-center justify-between gap-2">
                <span
                    className={`text-xs leading-snug ${
                        wouldReplace
                            ? "text-[var(--ag-colorWarningText)]"
                            : "text-[var(--ag-colorTextDescription)]"
                    }`}
                >
                    {wouldReplace ? (
                        "This mapping is richer than one message — typing here replaces it. Edit it under Advanced."
                    ) : (
                        <>
                            Sent to the agent{" "}
                            {isChat ? "as the user message" : `as the "${primaryKey}" input`} on
                            each run.
                        </>
                    )}
                </span>
                <button
                    type="button"
                    className={`${LINK_CLASS} shrink-0 text-xs`}
                    onClick={() => setRawMode(true)}
                >
                    Advanced — raw JSON
                </button>
            </div>
        </div>
    )
}
