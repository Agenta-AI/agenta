/** The "When this happens" section body: the chosen source summary + its event filters. */
import {useMemo} from "react"

import {
    useTriggerCatalogIntegrations,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {PencilSimple, Plus} from "@phosphor-icons/react"

import {AppLogo} from "../../../drawers/shared/CatalogAppCard"
import SchemaForm, {type SchemaFormHandle} from "../../../gatewayTool/components/SchemaForm"

import {connectionName} from "./helpers"

// ---------------------------------------------------------------------------
// SourceField — connection + event selection and the event-config schema. This
// is the subscription analog of the schedule's cron builder ("when").
// ---------------------------------------------------------------------------

// SourceField (in the section): the CHOSEN source as a 2-panel summary (source on the
// left rail + its event filters on the right), or a CTA when nothing is chosen. The actual
// app/event selection happens on the full SourceBrowsePage (opened via `onBrowse`).
export function SourceField({
    connections,
    connectionId,
    eventKey,
    eventName,
    onBrowse,
    isEdit,
    triggerConfigSchema,
    configForm,
    configFormRef,
}: {
    connections: TriggerConnection[]
    connectionId?: string
    eventKey: string
    eventName?: string
    onBrowse: () => void
    isEdit: boolean
    triggerConfigSchema: Record<string, unknown> | null
    /** antd FormInstance bridge — SchemaForm (gatewayTool) still requires one; typed via its props so this file stays antd-free. */
    configForm: React.ComponentProps<typeof SchemaForm>["form"]
    configFormRef: React.RefObject<SchemaFormHandle | null>
}) {
    const {integrations} = useTriggerCatalogIntegrations()
    const byKey = useMemo(() => {
        const m = new Map<string, TriggerCatalogIntegration>()
        integrations.forEach((i) => m.set(i.key, i))
        return m
    }, [integrations])

    if (!eventKey) {
        return (
            <button
                type="button"
                onClick={onBrowse}
                className="box-border flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-[var(--ag-colorBorder)] bg-transparent px-3 py-3 text-left hover:border-[var(--ag-colorPrimary)]"
            >
                <Plus size={16} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                <span className="flex-1 text-xs text-[var(--ag-colorTextSecondary)]">
                    Choose a connected app and the event that fires this trigger
                </span>
                <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">→</span>
            </button>
        )
    }

    const selected = connections.find((c) => c.id === connectionId)
    const logo = selected ? byKey.get(selected.integration_key)?.logo : undefined
    return (
        <div className="flex gap-3">
            <div className="flex w-[200px] shrink-0 flex-col">
                <button
                    type="button"
                    onClick={onBrowse}
                    disabled={isEdit}
                    title={isEdit ? undefined : "Change trigger"}
                    className="group flex items-start gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-transparent px-3 py-2 text-left enabled:cursor-pointer enabled:hover:border-[var(--ag-colorPrimary)]"
                >
                    <AppLogo logo={logo} size={20} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{eventName || eventKey}</div>
                        <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                            via {connectionName(selected) || "connection"}
                        </div>
                    </div>
                    {!isEdit && (
                        <PencilSimple
                            size={14}
                            className="mt-0.5 shrink-0 text-[var(--ag-colorTextTertiary)] opacity-0 transition-opacity group-hover:opacity-100"
                        />
                    )}
                </button>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                <span className="text-[11px] leading-snug text-[var(--ag-colorTextDescription)]">
                    Event filters
                </span>
                {triggerConfigSchema ? (
                    <div className="max-w-prose">
                        <SchemaForm
                            ref={configFormRef}
                            form={configForm}
                            schema={triggerConfigSchema}
                            flat
                        />
                    </div>
                ) : (
                    <span className="text-[11px] text-[var(--ag-colorTextDescription)]">
                        No filters for this event.
                    </span>
                )}
            </div>
        </div>
    )
}
