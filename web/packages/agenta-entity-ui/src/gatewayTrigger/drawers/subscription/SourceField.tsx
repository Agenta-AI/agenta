/** The subscription's source control (which app event fires it) and its event filters. */
import {useMemo} from "react"

import {
    useTriggerCatalogIntegrations,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {cn, selectTriggerVariants} from "@agenta/ui/ui"
import {ChevronDown, X} from "lucide-react"

import {AppLogo} from "../../../drawers/shared/CatalogAppCard"
import SchemaForm, {type SchemaFormHandle} from "../../../gatewayTool/components/SchemaForm"

import {connectionName} from "./helpers"

// ---------------------------------------------------------------------------
// SourceField — the chosen app event as ONE field-height control, the subscription analog of
// the schedule's cron row. The actual app/event selection happens on the full SourceBrowsePage
// (opened via `onBrowse`); this only shows what is bound and opens that page.
// ---------------------------------------------------------------------------

export function SourceField({
    connections,
    connectionId,
    eventKey,
    eventName,
    onBrowse,
    onClear,
    isEdit,
}: {
    connections: TriggerConnection[]
    connectionId?: string
    eventKey: string
    eventName?: string
    onBrowse: () => void
    onClear: () => void
    isEdit: boolean
}) {
    const {integrations} = useTriggerCatalogIntegrations()
    const byKey = useMemo(() => {
        const m = new Map<string, TriggerCatalogIntegration>()
        integrations.forEach((i) => m.set(i.key, i))
        return m
    }, [integrations])

    const selected = connections.find((c) => c.id === connectionId)
    const logo = selected ? byKey.get(selected.integration_key)?.logo : undefined
    const via = connectionName(selected)

    // A div, not a button: the clear affordance is itself a button and cannot nest inside one.
    // Same trigger styling as the Combobox, which uses this variant on a div for the same reason.
    return (
        <div
            // Derive the height from padding + line-height like Input does, so this lines up
            // with the Name field. SelectTrigger's own `h-control` is 2px shorter.
            className={cn(
                selectTriggerVariants(),
                "h-auto py-input-y",
                isEdit && "cursor-not-allowed bg-disabled-bg text-disabled",
            )}
        >
            <button
                type="button"
                onClick={onBrowse}
                // The source is part of the trigger's identity — changing it on a live
                // subscription would rebind the provider hook, so edit mode is read-only.
                disabled={isEdit}
                title={isEdit ? undefined : "Change trigger"}
                // text-field-md: preflight is off, so a bare button keeps the UA's 13.33px
                // Arial — which shortens the row by 4px against the Name input.
                className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-field-md text-inherit enabled:cursor-pointer disabled:cursor-not-allowed"
            >
                {eventKey ? (
                    <>
                        <AppLogo logo={logo} size={16} />
                        <span className="min-w-0 truncate">{eventName || eventKey}</span>
                        {via ? (
                            <span className="min-w-0 shrink truncate text-[var(--ag-colorTextDescription)]">
                                via {via}
                            </span>
                        ) : null}
                    </>
                ) : (
                    <span className="truncate text-[var(--ag-colorTextPlaceholder)]">
                        Choose a connected app and event
                    </span>
                )}
            </button>
            {isEdit ? null : eventKey ? (
                <button
                    type="button"
                    onClick={onClear}
                    aria-label="Clear trigger"
                    title="Clear trigger"
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-placeholder hover:text-[var(--ag-colorText)]"
                >
                    <X className="size-3" />
                </button>
            ) : (
                <ChevronDown className="size-3 shrink-0 text-placeholder" />
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// EventFiltersField — the event's own `trigger_config` schema (e.g. which repo, which label).
// Often required for the event to fire at all, so the form renders it inline under the
// trigger; the caller owns whether the section shows (an event without a schema has none).
// ---------------------------------------------------------------------------

export function EventFiltersField({
    triggerConfigSchema,
    configForm,
    configFormRef,
}: {
    triggerConfigSchema: Record<string, unknown> | null
    /** antd FormInstance bridge — SchemaForm (gatewayTool) still requires one; typed via its props so this file stays antd-free. */
    configForm: React.ComponentProps<typeof SchemaForm>["form"]
    configFormRef: React.RefObject<SchemaFormHandle | null>
}) {
    if (!triggerConfigSchema) return null
    return <SchemaForm ref={configFormRef} form={configForm} schema={triggerConfigSchema} flat />
}
