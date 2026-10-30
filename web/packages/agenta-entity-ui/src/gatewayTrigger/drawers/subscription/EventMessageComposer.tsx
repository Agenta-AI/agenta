/** The event automation's instruction: text plus event-field pills, over `inputs_fields`. */
import type {ReactNode} from "react"

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
    insertApi,
    fields,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    insertApi?: React.MutableRefObject<{insert: (selector: string) => void} | null>
    /** The event's field tags, drawn inside the instruction box under the text. */
    fields?: ReactNode
}) {
    const template = parseMessageTemplate(inputsText, isChat, primaryKey)

    return (
        <div className="flex flex-col gap-1.5">
            <PillEditor
                value={template ?? ""}
                onChange={(next) =>
                    onChange(compileMessageTemplate(inputsText, next, isChat, primaryKey))
                }
                insertApi={insertApi}
                labelFor={selectorLabel}
                footer={fields}
                ariaLabel="Instruction"
            />
            <span
                className={`text-xs leading-snug ${
                    template === null
                        ? "text-[var(--ag-colorWarningText)]"
                        : "text-[var(--ag-colorTextDescription)]"
                }`}
            >
                {template === null
                    ? "This automation sends a richer set of inputs than one message. Typing here replaces them."
                    : "Sent to the agent each time this event happens. Fields fill in with the real values."}
            </span>
        </div>
    )
}
