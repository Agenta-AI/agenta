/** The event's fields with their live values — one click drops a field into the mapping. */
import {useMemo} from "react"

import {previewValue, resolveSelectorPreview} from "@agenta/entities/gatewayTrigger"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {selectorLabel} from "./helpers"

// ---------------------------------------------------------------------------
// EventFieldList — the single view of the sampled event, shared by both mapping editors.
// It replaces what used to be three separate renderings of the same payload (a chip strip of
// available paths, a collapsed raw-JSON dump, and the per-path preview): one list, each row
// showing what the path resolves to right now, and clicking it writes the path into the
// mapping instead of making the user retype it.
// ---------------------------------------------------------------------------

export interface EventField {
    /** Attribute name, e.g. `subject`. */
    key: string
    /** Full selector, e.g. `$.event.attributes.subject`. */
    selector: string
    label: string
    value: string
}

export function useEventFields(context: Record<string, unknown>): EventField[] {
    return useMemo(() => {
        const attrs = (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {}
        return Object.keys(attrs).map((key) => {
            const selector = `$.event.attributes.${key}`
            const resolved = resolveSelectorPreview(selector, context)
            return {
                key,
                selector,
                label: selectorLabel(selector),
                value: resolved === undefined ? "—" : previewValue(resolved),
            }
        })
    }, [context])
}

export function EventFieldList({
    fields,
    onPick,
    disabled,
    emptyHint = "Get a sample event to see its fields and values.",
    className = "max-h-[220px]",
}: {
    fields: EventField[]
    onPick: (field: EventField) => void
    disabled?: boolean
    emptyHint?: string
    className?: string
}) {
    if (fields.length === 0) {
        return (
            <div className="rounded-md border border-dashed border-[var(--ag-colorBorder)] px-2 py-3 text-center text-xs leading-snug text-[var(--ag-colorTextTertiary)]">
                {emptyHint}
            </div>
        )
    }

    return (
        <div className={`flex flex-col gap-0.5 overflow-y-auto ${className}`}>
            {fields.map((f) => (
                <TooltipProvider key={f.key} delayDuration={400}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onPick(f)}
                                className="group flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left enabled:cursor-pointer enabled:hover:bg-[var(--ag-colorFillSecondary)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-[var(--ag-colorText)]">
                                        {f.label}
                                    </span>
                                    <span className="block truncate font-mono text-xs text-[var(--ag-colorTextSecondary)]">
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
                            {`${f.label}: ${f.value.slice(0, 300)}${f.value.length > 300 ? "…" : ""}`}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ))}
        </div>
    )
}
