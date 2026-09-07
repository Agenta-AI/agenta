import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    useTriggerConnectionsQuery,
    useTriggerEvent,
    type TriggerSubscription,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {SchemaForm, type SchemaFormHandle} from "@agenta/entity-ui/gatewayTool"
import {SourceBrowsePage, useSchemaFormInstance} from "@agenta/entity-ui/gatewayTrigger"
import {CaretLeft, Warning} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

import {buildAutomationEdit} from "../automationEdit"
import type {Automation} from "../automationModel"
import {useAutomation} from "../useAutomation"

import {PickerOverlay} from "./PickerOverlay"

/**
 * Which event runs this automation.
 *
 * Nothing here is a mobile reimplementation of the desktop chooser. `SourceBrowsePage` IS the
 * subscription drawer's "choose a trigger" step — the same app rail, the same search, the same
 * event list, already phone-aware (it collapses the rail below `sm`) — and the event's own
 * `trigger_config` filters are the same `SchemaForm`, which puts the optional ones behind its own
 * "Optional (N)" disclosure. This file is the two of them in one overlay plus the save.
 *
 * Unlike the agent field, this one commits on **Done**, not on pick: an event whose required
 * filters are empty (GitHub's owner/repo) is a subscription that can never fire, so saving the
 * moment the event is chosen would write a broken automation and call it done.
 */
export const EventPicker = ({
    automation,
    trigger,
}: {
    automation: Automation
    trigger: ReactNode
}) => {
    const [open, setOpen] = useState(false)
    const {connections} = useTriggerConnectionsQuery()
    const {edit} = useAutomation(automation.id, automation.kind)

    const [connectionId, setConnectionId] = useState(automation.connectionId ?? undefined)
    const [eventKey, setEventKey] = useState(automation.eventKey ?? "")
    const [browsing, setBrowsing] = useState(!automation.eventKey)
    const [values, setValues] = useState<Record<string, unknown>>({})
    const [saving, setSaving] = useState(false)

    // SchemaForm keeps its state in a host-owned form instance — the only way to prefill the
    // stored filters, and the only way to read them back validated.
    const [configForm] = useSchemaFormInstance()
    const formRef = useRef<SchemaFormHandle>(null)

    const storedConfig = useMemo(
        () =>
            ((automation.raw as TriggerSubscription).data?.trigger_config ?? {}) as Record<
                string,
                unknown
            >,
        [automation.raw],
    )

    const connection = useMemo(
        () => connections.find((candidate) => candidate.id === connectionId),
        [connections, connectionId],
    )
    const {event} = useTriggerEvent(connection?.integration_key ?? "", eventKey)
    const schema = (event?.trigger_config ?? null) as Record<string, unknown> | null

    // Reopening restarts from what is SAVED, not from an abandoned edit: the overlay unmounts on
    // close, so a half-picked event must not survive as the next session's starting point.
    useEffect(() => {
        if (!open) return
        setConnectionId(automation.connectionId ?? undefined)
        setEventKey(automation.eventKey ?? "")
        setBrowsing(!automation.eventKey)
        setSaving(false)
    }, [open, automation.connectionId, automation.eventKey])

    // Filters belong to the event's own schema, so a different event starts from empty; the
    // bound one starts from what is stored, or Done would silently clear it.
    useEffect(() => {
        if (!open) return
        const initial = eventKey && eventKey === automation.eventKey ? storedConfig : {}
        configForm.resetFields()
        configForm.setFieldsValue(initial)
        setValues(initial)
    }, [open, eventKey, automation.eventKey, storedConfig, configForm])

    const missing = useMemo(() => requiredGaps(schema, values), [schema, values])
    const ready = Boolean(connectionId && eventKey) && missing.length === 0

    const onPick = useCallback((pickedConnectionId: string, pickedEventKey: string) => {
        setConnectionId(pickedConnectionId)
        setEventKey(pickedEventKey)
        setBrowsing(false)
    }, [])

    const onDone = useCallback(async () => {
        if (!connectionId || !eventKey) return
        setSaving(true)
        try {
            // Throws on a failed rule — SchemaForm has already painted the inline errors, so
            // there is nothing to report here beyond staying open.
            const triggerConfig = await formRef.current?.getValues()
            const body = buildAutomationEdit(automation, {}) as TriggerSubscriptionEdit
            const saved = await edit({
                ...body,
                connection_id: connectionId,
                data: {
                    ...body.data,
                    event_key: eventKey,
                    trigger_config: triggerConfig ?? undefined,
                },
            })
            if (saved) setOpen(false)
        } catch {
            // Validation failure or a rejected save: the overlay stays open with the edit intact.
        } finally {
            setSaving(false)
        }
    }, [automation, connectionId, edit, eventKey])

    return (
        <PickerOverlay
            open={open}
            onOpenChange={setOpen}
            title="Run on which event?"
            trigger={trigger}
            contentClassName="w-[480px]"
        >
            {/* One height for both panes: the browse step and the filters step must not resize
                the overlay as the user moves between them. */}
            <div className="flex h-[60vh] max-h-[560px] min-h-[320px] flex-col lg:h-[460px]">
                {browsing ? (
                    <>
                        {automation.eventKey ? (
                            <div className="flex shrink-0 items-center border-b px-2 py-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setBrowsing(false)}
                                >
                                    <CaretLeft aria-hidden size={14} />
                                    Back
                                </Button>
                            </div>
                        ) : null}
                        <div className="min-h-0 flex-1">
                            <SourceBrowsePage
                                connections={connections}
                                // Re-opening a bound event lands on its app's event list, not
                                // back at the app grid — the app is rarely what changed.
                                defaultIntegrationKey={connection?.integration_key}
                                onPick={onPick}
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
                            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                                {event?.name || eventKey}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setBrowsing(true)}
                            >
                                Change
                            </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                            {schema ? (
                                <SchemaForm
                                    ref={formRef}
                                    form={configForm}
                                    schema={schema}
                                    onValuesChange={setValues}
                                />
                            ) : (
                                <p className="text-muted-foreground m-0 py-2 text-xs">
                                    This event needs no filters — it runs every time it arrives.
                                </p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
                            {missing.length ? (
                                <p className="text-muted-foreground m-0 flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-snug">
                                    <Warning aria-hidden size={14} className="shrink-0" />
                                    <span className="min-w-0">
                                        {missing.length === 1
                                            ? "One filter is still empty"
                                            : `${missing.length} filters are still empty`}
                                        {" — without them this event never arrives."}
                                    </span>
                                </p>
                            ) : (
                                <span className="flex-1" />
                            )}
                            <Button
                                type="button"
                                size="sm"
                                disabled={!ready || saving}
                                onClick={() => void onDone()}
                            >
                                Done
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </PickerOverlay>
    )
}

/**
 * The event's required filters that are still blank.
 *
 * Drives the footer warning and the Done gate together, so the button and the sentence explaining
 * it can never disagree. JSON Schema's `required` is untyped here (the schema arrives as raw
 * provider JSON), hence the narrowing rather than a cast.
 */
function requiredGaps(
    schema: Record<string, unknown> | null,
    values: Record<string, unknown>,
): string[] {
    const declared = schema?.required
    if (!Array.isArray(declared)) return []
    return declared
        .filter((key): key is string => typeof key === "string")
        .filter((key) => {
            const value = values[key]
            if (value === undefined || value === null || value === "") return true
            return Array.isArray(value) && value.length === 0
        })
}
