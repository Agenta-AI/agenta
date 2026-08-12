/** The non-agent mapping editor: raw `inputs_fields` JSON with per-leaf selector previews. */
import {useEffect, useMemo} from "react"

import {previewValue, resolveSelectorPreview} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Field} from "@agenta/ui/ui"

import {EventFieldList, useEventFields, type EventField} from "./EventFieldList"
import {buildPreviewContext} from "./helpers"

// ---------------------------------------------------------------------------
// Non-agent mapping: raw-JSON editor with live selector validation + path hints
// (restored committed behavior). Each leaf string is a selector resolved at delivery
// (`$...` JSONPath, `/...` JSON Pointer, else literal); we preview each against the sample.
// ---------------------------------------------------------------------------

interface MappingLeaf {
    key: string
    isSelector: boolean
    resolved?: string
}

function analyzeMapping(
    text: string,
    context: Record<string, unknown> | null,
): {leaves: MappingLeaf[]; parseError: string | null} {
    const trimmed = text.trim()
    if (!trimmed) return {leaves: [], parseError: null}
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch (e) {
        return {leaves: [], parseError: e instanceof Error ? e.message : "Invalid JSON"}
    }
    if (typeof parsed === "string") {
        const isSelector = parsed.startsWith("$") || parsed.startsWith("/")
        const resolved = isSelector && context ? resolveSelectorPreview(parsed, context) : undefined
        return {
            leaves: [
                {
                    key: "(whole context)",
                    isSelector,
                    resolved: resolved === undefined ? undefined : previewValue(resolved),
                },
            ],
            parseError: null,
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {leaves: [], parseError: "Mapping must be a JSON object or a selector string"}
    }
    const leaves: MappingLeaf[] = []
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof rawValue !== "string") {
            leaves.push({key, isSelector: false})
            continue
        }
        const isSelector = rawValue.startsWith("$") || rawValue.startsWith("/")
        if (!isSelector) {
            leaves.push({key, isSelector: false})
            continue
        }
        const resolved = context ? resolveSelectorPreview(rawValue, context) : undefined
        leaves.push({
            key,
            isSelector: true,
            resolved: resolved === undefined ? undefined : previewValue(resolved),
        })
    }
    return {leaves, parseError: null}
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
    const {leaves, parseError} = useMemo(() => analyzeMapping(value, context), [value, context])
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
                <div className="mt-2 flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--ag-colorTextDescription)]">
                        Event fields
                    </span>
                    <EventFieldList fields={fields} onPick={addField} disabled={disabled} />
                </div>
                {!parseError && leaves.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                        {leaves.map((leaf, i) => (
                            <div
                                key={`${leaf.key}-${i}`}
                                className="flex items-center gap-1.5 text-xs leading-snug"
                            >
                                <code className="text-[var(--ag-colorTextSecondary)]">
                                    {leaf.key}
                                </code>
                                <span className="text-[var(--ag-colorTextTertiary)]">→</span>
                                {leaf.isSelector ? (
                                    leaf.resolved === undefined ? (
                                        <span className="text-xs text-[var(--ag-colorWarningText)]">
                                            no sample value
                                        </span>
                                    ) : (
                                        <code className="max-w-[280px] truncate text-[var(--ag-colorSuccess)]">
                                            {leaf.resolved}
                                        </code>
                                    )
                                ) : (
                                    <span className="text-xs text-[var(--ag-colorTextDescription)]">
                                        literal
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Field>
    )
}
