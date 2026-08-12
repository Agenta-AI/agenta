/** The subscription's source control (which app event fires it) and its event filters. */
import {useMemo} from "react"

import {
    useTriggerCatalogIntegrations,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {cn, selectTriggerVariants} from "@agenta/ui/ui"
import {ChevronDown} from "lucide-react"

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
    isEdit,
}: {
    connections: TriggerConnection[]
    connectionId?: string
    eventKey: string
    eventName?: string
    onBrowse: () => void
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

    return (
        <button
            type="button"
            onClick={onBrowse}
            // The source is part of the trigger's identity — changing it on a live
            // subscription would rebind the provider hook, so edit mode is read-only.
            disabled={isEdit}
            title={isEdit ? undefined : "Change trigger"}
            // Derive the height from padding + line-height like Input does, so this lines up
            // with the Name field. SelectTrigger's own `h-control` is 2px shorter.
            className={cn(selectTriggerVariants(), "h-auto py-input-y")}
        >
            <span className="flex min-w-0 items-center gap-2">
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
            </span>
            {isEdit ? null : <ChevronDown className="size-3 shrink-0 text-placeholder" />}
        </button>
    )
}

// ---------------------------------------------------------------------------
// EventFiltersField — the event's own `trigger_config` schema (e.g. which repo, which label).
// Optional per event, so it lives under Advanced.
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
    if (!triggerConfigSchema) {
        return (
            <span className="text-xs text-[var(--ag-colorTextDescription)]">
                No filters for this event.
            </span>
        )
    }
    return <SchemaForm ref={configFormRef} form={configForm} schema={triggerConfigSchema} flat />
}
