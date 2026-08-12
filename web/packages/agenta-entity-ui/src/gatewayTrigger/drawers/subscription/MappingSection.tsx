/** The "What the agent gets" section body: token composer (agents) or raw-JSON mapping. */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    compileMessageTemplate,
    getScheduleMessagePreview,
    parseMessageTemplate,
} from "@agenta/entities/gatewayTrigger"
import {HeightCollapse} from "@agenta/ui/components"
import {Editor} from "@agenta/ui/editor"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {CaretDown, Info, Lightning} from "@phosphor-icons/react"

import {EventSourcePicker, type SampledEvent} from "../shared/EventSourcePicker"

import {EventFieldList, useEventFields} from "./EventFieldList"
import {buildPreviewContext} from "./helpers"
import {InputsMappingField} from "./InputsMappingField"
import {PillEditor} from "./PillEditor"

// ---------------------------------------------------------------------------
// MappingSection — map the live event payload into the agent's inputs. "Get a
// sample event" pulls a real event (EventSourcePicker) so selectors preview
// against concrete data. Each leaf string is a selector resolved at delivery.
// ---------------------------------------------------------------------------

export function MappingSection({
    value,
    onChange,
    error,
    onErrorChange,
    eventSample,
    deliveryPreview,
    onSample,
    onWaitForEvent,
    recentEvents = [],
    isAgent,
    isEdit,
    hasSource,
    isChat,
    primaryKey,
    disabled,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    onErrorChange: (next: string | null) => void
    /** RAW event (catalog schema / draft probe) — the field panel + preview source. */
    eventSample: Record<string, unknown> | null
    /** A saved trigger's last delivered (mapped) output — shown read-only, never a field source. */
    deliveryPreview?: Record<string, unknown> | null
    onSample: (event: SampledEvent) => void
    onWaitForEvent?: () => Promise<SampledEvent | null>
    recentEvents?: SampledEvent[]
    isAgent: boolean
    isEdit: boolean
    /** No app/event chosen yet — there are no event fields to offer. */
    hasSource: boolean
    isChat: boolean
    primaryKey: string
    /** The surrounding fieldset covers native controls (buttons); the raw-JSON `Editor` and the
     * composer's contenteditable `PillEditor` aren't native form controls, so they need this. */
    disabled?: boolean
}) {
    const context = useMemo(() => buildPreviewContext(eventSample), [eventSample])
    // Is the CURRENT mapping richer than one message? The composer only ever emits a single
    // key, so anything with siblings (the `{"context": "$"}` default, the SDK's recommended
    // `{messages, event}` pair) compiles away the moment the user types.
    const richerThanComposer =
        !!value.trim() && parseMessageTemplate(value, isChat, primaryKey) === ""
    // Always open on the composer — raw JSON is an escape hatch the user asks for, never the
    // first thing they see. A saved mapping the composer can't reproduce gets the warning below
    // instead, so nothing is replaced silently.
    const [raw, setRaw] = useState(false)
    // The field list is a lookup, not part of writing the message — collapsed until wanted.
    const [fieldsOpen, setFieldsOpen] = useState(false)
    const insertApi = useRef<{insert: (path: string) => void} | null>(null)

    // Token template is the composer's source of truth; it compiles to `value`
    // (inputs_fields JSON). Resync only when `value` changes from OUTSIDE (e.g. the
    // edit-mode prefill loads) — detected by comparing against our own compilation.
    const [template, setTemplate] = useState(() => parseMessageTemplate(value, isChat, primaryKey))

    // The bound agent's shape resolves asynchronously, so it can change under a message the
    // user already typed (chat agents take `messages`, completion agents a named input).
    const shapeRef = useRef({isChat, primaryKey})

    useEffect(() => {
        const shapeChanged =
            shapeRef.current.isChat !== isChat || shapeRef.current.primaryKey !== primaryKey
        shapeRef.current = {isChat, primaryKey}
        // On a shape change `value` was written under the OLD shape, so re-reading it would
        // parse as unrepresentable and wipe the composer. Recompile the text instead.
        if (shapeChanged && template) {
            onChange(JSON.stringify(compileMessageTemplate(template, isChat, primaryKey), null, 2))
            return
        }
        const compiled = JSON.stringify(compileMessageTemplate(template, isChat, primaryKey))
        let current = value
        try {
            current = JSON.stringify(JSON.parse(value))
        } catch {
            /* keep raw */
        }
        if (compiled !== current) setTemplate(parseMessageTemplate(value, isChat, primaryKey))
    }, [value, isChat, primaryKey, template, onChange])

    // Surface raw-JSON parse errors (the composer always emits valid JSON). Single owner:
    // the non-agent path renders InputsMappingField, which reports a richer message.
    useEffect(() => {
        if (!isAgent) return
        if (!value.trim()) {
            onErrorChange(null)
            return
        }
        try {
            JSON.parse(value)
            onErrorChange(null)
        } catch {
            onErrorChange("Invalid JSON")
        }
    }, [value, isAgent, onErrorChange])

    const setTpl = useCallback(
        (next: string) => {
            setTemplate(next)
            onChange(JSON.stringify(compileMessageTemplate(next, isChat, primaryKey), null, 2))
        },
        [onChange, isChat, primaryKey],
    )

    const fields = useEventFields(context)

    // Non-agent workflows keep the committed raw-JSON mapping editor (no token composer).
    if (!isAgent) {
        return (
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                        Map the event into the workflow inputs (JSON).
                        <TooltipProvider delayDuration={200}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    {/* The selector syntax is read once — an icon, not two
                                        permanent lines of legend under the editor. */}
                                    <button
                                        type="button"
                                        aria-label="Selector syntax"
                                        className="flex cursor-help items-center border-0 bg-transparent p-0 text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorTextSecondary)]"
                                    >
                                        <Info size={13} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[280px]">
                                    String values are selectors against the event payload:
                                    {" $.path "}
                                    (JSONPath), {"/path "}
                                    (JSON Pointer), or a literal.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </span>
                    <EventSourcePicker
                        placement="bottomRight"
                        trigger={
                            <button
                                type="button"
                                className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                            >
                                <Lightning size={12} weight="fill" /> Test event
                            </button>
                        }
                        recentEvents={recentEvents}
                        onPick={onSample}
                        onWaitForEvent={onWaitForEvent}
                        waitHint="trigger it from the app now"
                        captureMode
                    />
                </div>
                <InputsMappingField
                    value={value}
                    onChange={onChange}
                    error={error}
                    onErrorChange={onErrorChange}
                    eventPayload={eventSample}
                    disabled={disabled}
                />
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                    {isChat
                        ? "Write the message your agent receives."
                        : "Build the agent's input from the event."}
                </span>
                <EventSourcePicker
                    placement="bottomRight"
                    trigger={
                        <button
                            type="button"
                            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                        >
                            <Lightning size={12} weight="fill" /> Test event
                        </button>
                    }
                    recentEvents={recentEvents}
                    onPick={onSample}
                    onWaitForEvent={onWaitForEvent}
                    waitHint="trigger it from the app now"
                    captureMode
                />
            </div>

            {raw ? (
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={value || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 140}}
                        disabled={disabled}
                    />
                </div>
            ) : (
                <>
                    <PillEditor
                        value={template}
                        onChange={setTpl}
                        insertApi={insertApi}
                        placeholder={
                            isChat
                                ? "Type a message and click a field below to insert its value…"
                                : "Build the agent's input — type text and click a field below…"
                        }
                        disabled={disabled}
                    />
                    {/* Only for a SAVED mapping: on create the richer value is our own default,
                        and there is nothing of the user's to lose. */}
                    {isEdit && richerThanComposer ? (
                        <span className="text-xs leading-snug text-[var(--ag-colorWarningText)]">
                            This trigger sends a richer set of inputs than one message — typing here
                            replaces them.
                        </span>
                    ) : null}
                    {deliveryPreview && (
                        <div className="rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] px-2.5 py-1.5">
                            <div className="mb-0.5 text-[12px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                Agent received · last real delivery
                            </div>
                            <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-xs text-[var(--ag-colorText)]">
                                {getScheduleMessagePreview(deliveryPreview) || "—"}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col">
                        <div className="flex items-center justify-between gap-2">
                            {/* Event fields only exist once an app + event are chosen; the empty
                                slot keeps the JSON escape on the right either way. */}
                            {hasSource ? (
                                <button
                                    type="button"
                                    onClick={() => setFieldsOpen((v) => !v)}
                                    aria-expanded={fieldsOpen}
                                    // px-0/font-[inherit]: preflight is off, so a bare button
                                    // keeps the UA's inline padding and Arial.
                                    className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 py-1 font-[inherit] text-xs font-medium text-[var(--ag-colorTextDescription)] hover:text-[var(--ag-colorText)]"
                                >
                                    <CaretDown
                                        size={12}
                                        className={`transition-transform ${
                                            fieldsOpen ? "" : "-rotate-90"
                                        }`}
                                    />
                                    Event fields
                                    {fields.length ? (
                                        <span className="text-[var(--ag-colorTextTertiary)]">
                                            {fields.length}
                                        </span>
                                    ) : null}
                                </button>
                            ) : (
                                <span />
                            )}
                            <button
                                type="button"
                                onClick={() => setRaw(true)}
                                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                            >
                                View as JSON
                            </button>
                        </div>
                        <HeightCollapse open={fieldsOpen && hasSource}>
                            <EventFieldList
                                fields={fields}
                                onPick={(f) =>
                                    insertApi.current?.insert(`event.attributes.${f.key}`)
                                }
                                disabled={disabled}
                                className="max-h-[180px]"
                            />
                        </HeightCollapse>
                    </div>
                </>
            )}

            {raw ? (
                <button
                    type="button"
                    onClick={() => setRaw(false)}
                    className="cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                >
                    ← Back to composer
                </button>
            ) : null}

            {error && <span className="text-xs text-[var(--ag-colorErrorText)]">{error}</span>}
        </div>
    )
}
