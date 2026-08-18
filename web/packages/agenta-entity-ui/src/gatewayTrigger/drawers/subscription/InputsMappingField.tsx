/** The non-agent mapping editor: raw `inputs_fields` JSON with click-to-insert event fields. */
import {useEffect, useMemo} from "react"

import {Editor} from "@agenta/ui/editor"
import {Field} from "@agenta/ui/ui"

import {EventFieldList, useEventFields, type EventField} from "./EventFieldList"
import {buildPreviewContext} from "./helpers"

// ---------------------------------------------------------------------------
// Non-agent mapping: a raw-JSON editor over `inputs_fields`. Each leaf string is a selector
// resolved at delivery (`$...` JSONPath, `/...` JSON Pointer, else a literal); the event-field
// list below writes those selectors so they don't have to be retyped.
// ---------------------------------------------------------------------------

/** Validation only — the mapping is JSON, and anything else is a parse error to surface. */
function mappingParseError(text: string): string | null {
    const trimmed = text.trim()
    if (!trimmed) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch (e) {
        return e instanceof Error ? e.message : "Invalid JSON"
    }
    if (typeof parsed === "string") return null
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Mapping must be a JSON object or a selector string"
    }
    return null
}

export function InputsMappingField({
    value,
    onChange,
    error,
    onErrorChange,
    eventPayload,
    disabled,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    onErrorChange: (next: string | null) => void
    eventPayload: Record<string, unknown> | null
    disabled?: boolean
}) {
    const context = useMemo(() => buildPreviewContext(eventPayload), [eventPayload])
    const parseError = useMemo(() => mappingParseError(value), [value])
    useEffect(() => {
        onErrorChange(parseError)
    }, [parseError, onErrorChange])
    const fields = useEventFields(context)

    // Clicking a field adds it as a mapping entry rather than making the user retype the
    // selector. Only possible while the JSON parses — otherwise there's no object to add to.
    const addField = (field: EventField) => {
        try {
            const parsed = JSON.parse(value.trim() || "{}")
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return
            onChange(JSON.stringify({...parsed, [field.key]: field.selector}, null, 2))
        } catch {
            // A malformed mapping already shows its parse error; don't compound it.
        }
    }
    // No label or description here — the surrounding field is already named, and the selector
    // syntax lives in the info tooltip beside it (see MappingSection).
    return (
        <Field error={error ?? undefined}>
            <div>
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={value || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 120}}
                        disabled={disabled}
                    />
                </div>
                {fields.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                        <span className="text-xs font-medium text-[var(--ag-colorTextDescription)]">
                            Event fields
                        </span>
                        <EventFieldList fields={fields} onPick={addField} disabled={disabled} />
                    </div>
                )}
            </div>
        </Field>
    )
}
