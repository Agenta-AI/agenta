/** The event automation's instruction: text plus event-field pills, over `inputs_fields`. */
import {useCallback} from "react"

import {
    compileMessageTemplate,
    parseMessageTemplate,
    selectorLabel,
} from "@agenta/entities/gatewayTrigger"

import {PillEditor} from "./PillEditor"

// The schedule composer's sibling for event automations. It keeps every key of the mapping
// except the message; a mapping it cannot show keeps the warning `MessageComposer` gives.
export function EventMessageComposer({
    inputsText,
    onChange,
    isChat,
    primaryKey,
    labels,
    insertApi,
    disabled,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    /** Selector → field label, from the event's field cards. */
    labels: Record<string, string>
    insertApi?: React.MutableRefObject<{insert: (selector: string) => void} | null>
    disabled?: boolean
}) {
    const template = parseMessageTemplate(inputsText, isChat, primaryKey)
    const labelFor = useCallback((selector: string) => selectorLabel(selector, labels), [labels])

    return (
        <div className="flex flex-col gap-1.5">
            <PillEditor
                value={template ?? ""}
                onChange={(next) =>
                    onChange(compileMessageTemplate(inputsText, next, isChat, primaryKey))
                }
                insertApi={insertApi}
                labelFor={labelFor}
                disabled={disabled}
            />
            <span
                className={`text-xs leading-snug ${
                    template === null
                        ? "text-[var(--ag-colorWarningText)]"
                        : "text-[var(--ag-colorTextDescription)]"
                }`}
            >
                {template === null
                    ? "This schedule sends a richer set of inputs than one message — typing here replaces them."
                    : "Sent to the agent each time this event happens. Fields fill in with the real values."}
            </span>
        </div>
    )
}
