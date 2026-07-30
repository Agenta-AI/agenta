/** The schedule drawer's "What should the agent do?" message / raw-JSON editor. */
import {useMemo, useState} from "react"

import {getScheduleMessage, setScheduleMessage} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Input, Typography} from "antd"

// ---------------------------------------------------------------------------
// MessageComposer — friendly "what should the agent do?" message that maps to the
// agent's primary input (`messages` for chat agents, else a schema string input).
// "Advanced — raw JSON" swaps to a JSON editor over the full `inputs_fields`; only
// one editor is mounted at a time so the message and JSON never desync. Always opens
// on the message — a mapping the composer can't reproduce warns instead of switching.
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
                <Typography.Link
                    className="!text-[11px] self-start"
                    onClick={() => setRawMode(false)}
                >
                    ← Back to message
                </Typography.Link>
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
                <Typography.Text
                    type={rawValid ? "secondary" : "danger"}
                    className="!text-[11px] leading-snug"
                >
                    {rawValid
                        ? "Raw inputs sent to the workflow each tick (JSON)."
                        : "Invalid JSON."}
                </Typography.Text>
            </div>
        )
    }

    const message = getScheduleMessage(inputsText, isChat, primaryKey)
    // The composer writes a single user message, so anything richer would be lost on edit.
    const wouldReplace = !message && !!inputsText.trim() && inputsText.trim() !== "{}"
    return (
        <div className="flex flex-col gap-1.5">
            <Input.TextArea
                placeholder="Summarize yesterday's support tickets and post the digest to #ops."
                value={message}
                onChange={(e) =>
                    onChange(setScheduleMessage(inputsText, e.target.value, isChat, primaryKey))
                }
                autoSize={{minRows: 2, maxRows: 6}}
                disabled={disabled}
            />
            <div className="flex items-center justify-between gap-2">
                <Typography.Text
                    type={wouldReplace ? "warning" : "secondary"}
                    className="!text-[11px] leading-snug"
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
                </Typography.Text>
                <Typography.Link
                    className="!shrink-0 !text-[11px]"
                    onClick={() => setRawMode(true)}
                >
                    Advanced — raw JSON
                </Typography.Link>
            </div>
        </div>
    )
}
