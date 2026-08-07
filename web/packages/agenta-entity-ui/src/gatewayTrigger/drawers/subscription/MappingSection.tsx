/** The "What the agent gets" section body: token composer (agents) or raw-JSON mapping. */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    compileMessageTemplate,
    getScheduleMessagePreview,
    parseMessageTemplate,
    previewValue,
    resolveSelectorPreview,
    splitTemplate,
} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Lightning, Plus} from "@phosphor-icons/react"

import {EventSourcePicker, type SampledEvent} from "../shared/EventSourcePicker"

import {buildPreviewContext, selectorLabel} from "./helpers"
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
    isChat,
    primaryKey,
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
    isChat: boolean
    primaryKey: string
}) {
    const samplePayload = eventSample
    const context = useMemo(() => buildPreviewContext(eventSample), [eventSample])
    // Open in Advanced (raw JSON) when editing a saved mapping the token composer can't
    // reproduce — otherwise the first composer edit would silently collapse it.
    const [raw, setRaw] = useState(
        () => isEdit && !!value.trim() && parseMessageTemplate(value, isChat, primaryKey) === "",
    )
    const insertApi = useRef<{insert: (path: string) => void} | null>(null)

    // Token template is the composer's source of truth; it compiles to `value`
    // (inputs_fields JSON). Resync only when `value` changes from OUTSIDE (e.g. the
    // edit-mode prefill loads) — detected by comparing against our own compilation.
    const [template, setTemplate] = useState(() => parseMessageTemplate(value, isChat, primaryKey))

    useEffect(() => {
        const compiled = JSON.stringify(compileMessageTemplate(template, isChat, primaryKey))
        let current = value
        try {
            current = JSON.stringify(JSON.parse(value))
        } catch {
            /* keep raw */
        }
        if (compiled !== current) setTemplate(parseMessageTemplate(value, isChat, primaryKey))
    }, [value, isChat, primaryKey])

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

    const fieldRows = useMemo(() => {
        const attrs = (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {}
        return Object.keys(attrs).map((k) => {
            const selector = `$.event.attributes.${k}`
            const resolved = resolveSelectorPreview(selector, context)
            return {
                key: k,
                label: selectorLabel(selector),
                value: resolved === undefined ? "—" : previewValue(resolved),
            }
        })
    }, [context])

    const preview = useMemo(
        () =>
            splitTemplate(template)
                .map((seg) => {
                    if (seg.literal != null) return seg.literal
                    const resolved = seg.selector
                        ? resolveSelectorPreview(seg.selector, context)
                        : undefined
                    return resolved === undefined ? "…" : previewValue(resolved)
                })
                .join(""),
        [template, context],
    )

    // Non-agent workflows keep the committed raw-JSON mapping editor (no token composer).
    if (!isAgent) {
        return (
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] leading-snug text-[var(--ag-colorTextDescription)]">
                        Map the event into the workflow inputs (JSON).
                    </span>
                    <EventSourcePicker
                        placement="bottomRight"
                        trigger={
                            <button
                                type="button"
                                className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--ag-colorPrimary)] hover:opacity-80"
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
                />
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[11px] leading-snug text-[var(--ag-colorTextDescription)]">
                {isChat
                    ? "Write the message your agent receives. Click a field to drop in its live value."
                    : "Build the agent's input from the event. Click a field to drop in its live value."}
            </span>

            {raw ? (
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={value || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 140}}
                    />
                </div>
            ) : (
                <div className="flex min-w-0 gap-3">
                    {/* Left rail = the data (event fields + live values), like the other sections' rails. */}
                    <div className="flex w-[200px] shrink-0 flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextDescription)]">
                                Event fields
                            </span>
                            <EventSourcePicker
                                placement="bottomRight"
                                trigger={
                                    <button
                                        type="button"
                                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--ag-colorPrimary)] hover:opacity-80"
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
                        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
                            {fieldRows.length > 0 ? (
                                fieldRows.map((f) => (
                                    <TooltipProvider key={f.key} delayDuration={400}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        insertApi.current?.insert(
                                                            `event.attributes.${f.key}`,
                                                        )
                                                    }
                                                    className="group flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                                                >
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium text-[var(--ag-colorText)]">
                                                            {f.label}
                                                        </span>
                                                        <span className="block truncate font-mono text-[11px] text-[var(--ag-colorTextSecondary)]">
                                                            {f.value}
                                                        </span>
                                                    </span>
                                                    <Plus
                                                        size={13}
                                                        className="shrink-0 text-[var(--ag-colorTextTertiary)] opacity-0 group-hover:text-[var(--ag-colorPrimary)] group-hover:opacity-100"
                                                    />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="left">
                                                {`${f.label}: ${f.value.slice(0, 300)}${
                                                    f.value.length > 300 ? "…" : ""
                                                }`}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                ))
                            ) : (
                                <div className="rounded-md border border-dashed border-[var(--ag-colorBorder)] px-2 py-3 text-center text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                    Get a sample event to see its fields and values.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right = the message built from that data (divider mirrors the other sections). */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextDescription)]">
                            Message
                        </span>
                        <PillEditor
                            value={template}
                            onChange={setTpl}
                            insertApi={insertApi}
                            placeholder={
                                isChat
                                    ? "Type a message and click a field on the left to insert its value…"
                                    : "Build the agent's input — type text and click fields on the left…"
                            }
                        />
                        {samplePayload && template.trim() && (
                            <div className="rounded-md bg-[var(--ag-colorFillQuaternary)] px-2.5 py-1.5">
                                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                    {deliveryPreview ? "Agent would receive" : "Agent receives"}
                                </div>
                                <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[var(--ag-colorText)]">
                                    {preview}
                                </div>
                            </div>
                        )}
                        {deliveryPreview && (
                            <div className="rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] px-2.5 py-1.5">
                                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                    Agent received · last real delivery
                                </div>
                                <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[var(--ag-colorText)]">
                                    {getScheduleMessagePreview(deliveryPreview) || "—"}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={() => setRaw((r) => !r)}
                className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
            >
                {raw ? "← Back to composer" : "Advanced · raw JSON"}
            </button>

            {error && <span className="text-[11px] text-[var(--ag-colorErrorText)]">{error}</span>}
        </div>
    )
}
