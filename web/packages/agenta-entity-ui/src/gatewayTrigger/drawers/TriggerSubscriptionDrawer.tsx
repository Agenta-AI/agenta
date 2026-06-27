import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {
    isEntityActive,
    isEntityValid,
    previewValue,
    queryTriggerDeliveries,
    resolveSelectorPreview,
    testTriggerSubscription,
    triggerApiErrorMessage,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogEvents,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type TriggerConnection,
    type TriggerDelivery,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {Editor} from "@agenta/ui/editor"
import {Code, Lightning, Play} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Drawer,
    Form,
    Input,
    Modal,
    Segmented,
    Select,
    Spin,
    Switch,
    Tooltip,
    Typography,
    message,
} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import SchemaForm, {type SchemaFormHandle} from "../../gatewayTool/components/SchemaForm"
import {
    createWorkflowRevisionAdapter,
    EntityPicker,
    type WorkflowRevisionSelectionResult,
} from "../../selection"

const DEFAULT_PROVIDER = "composio"

// Default demonstrates the object shape (so users learn they can map field-by-field)
// while `$` captures the whole context. A bare "$" string is also valid.
const DEFAULT_INPUTS_MAPPING = '{"context": "$"}'

// The bound reference is always `application_*` (see handleSubmit), so the picker
// only offers application workflows (is_application=True).
const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})

// ---------------------------------------------------------------------------
// TriggerSubscriptionDrawer (root) — create or edit a subscription.
//
// Binds a provider event (catalog) on a connected integration to a workflow
// revision. Edits are full-PUT: the body is sourced from the freshly-fetched
// subscription and only owned fields are overridden.
// ---------------------------------------------------------------------------

export default function TriggerSubscriptionDrawer() {
    const [state, setState] = useAtom(triggerSubscriptionDrawerAtom)
    const open = !!state
    const isEdit = !!state?.subscriptionId

    const handleClose = useCallback(() => setState(null), [setState])

    return (
        <Drawer
            open={open}
            onClose={handleClose}
            title={isEdit ? "Edit subscription" : "New subscription"}
            width={920}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", overflow: "hidden"},
            }}
        >
            {state && (
                <SubscriptionForm key={state.subscriptionId ?? "new"} onClose={handleClose} />
            )}
        </Drawer>
    )
}

// ---------------------------------------------------------------------------
// Subscription form
// ---------------------------------------------------------------------------

function SubscriptionForm({onClose}: {onClose: () => void}) {
    const [state] = useAtom(triggerSubscriptionDrawerAtom)
    const subscriptionId = state?.subscriptionId
    const isEdit = !!subscriptionId

    const {connections, isLoading: connectionsLoading} = useTriggerConnectionsQuery()
    const {
        subscription,
        isLoading: subLoading,
        isMutating,
        create,
        edit,
    } = useTriggerSubscription(subscriptionId)

    const [name, setName] = useState("")
    const [connectionId, setConnectionId] = useState<string | undefined>(state?.connectionId)
    const [eventKey, setEventKey] = useState(state?.eventKey ?? "")
    const [enabled, setEnabled] = useState(true)
    const [workflowRevId, setWorkflowRevId] = useState<string | null>(null)
    const [workflowSelection, setWorkflowSelection] =
        useState<WorkflowRevisionSelectionResult | null>(null)
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
    // Default maps the whole event context under `context` so a fresh test shows
    // everything; `$` resolves to the full resolution context.
    const [inputsText, setInputsText] = useState(DEFAULT_INPUTS_MAPPING)
    const [inputsError, setInputsError] = useState<string | null>(null)

    // Run agent version: bind to a specific revision (the picker) or to an
    // environment (always runs whatever is deployed there). Environment binding
    // resolves via the app slug + environment (triggers/service.py).
    const [bindMode, setBindMode] = useState<"revision" | "environment">("revision")
    const [environmentSlug, setEnvironmentSlug] = useState<string | null>(null)
    const [appSlug, setAppSlug] = useState<string | null>(null)
    const envQuery = useAtomValue(environmentsListQueryAtomFamily(false))
    const environments = envQuery.data?.environments ?? []

    // FE guard for a backend limitation: Composio upserts one trigger instance per
    // (connection, event), and `trigger_id` is unique — so testing/creating a second
    // subscription for an event that already has one 500s. Detect it and disable Test.
    const {subscriptions} = useTriggerSubscriptions()
    const alreadySubscribed = useMemo(
        () =>
            Boolean(connectionId && eventKey) &&
            subscriptions.some(
                (s) =>
                    s.id !== subscriptionId &&
                    s.connection_id === connectionId &&
                    s.data?.event_key === eventKey,
            ),
        [subscriptions, connectionId, eventKey, subscriptionId],
    )

    // Only the right-hand TestPlaygroundPanel runs/captures events; the form just
    // hands it the playground entityId (present only when opened from a playground).
    const playgroundEntityId = state?.playgroundEntityId

    const [configForm] = Form.useForm()
    const configFormRef = useRef<SchemaFormHandle>(null)

    // Prefill from the freshly-fetched subscription (edit mode).
    useEffect(() => {
        if (!isEdit || !subscription) return
        setName(subscription.name ?? "")
        setConnectionId(subscription.connection_id)
        setEventKey(subscription.data?.event_key ?? "")
        setEnabled(isEntityActive(subscription))
        const refs = subscription.data?.references
        const envRef = refs?.environment
        if (envRef) {
            setBindMode("environment")
            setEnvironmentSlug(envRef.slug ?? null)
            setAppSlug(refs?.application?.slug ?? null)
        } else {
            const wfId = refs?.application_revision?.id ?? refs?.workflow_revision?.id ?? null
            setWorkflowRevId(wfId)
            setWorkflowLabel(wfId)
        }
        setInputsText(
            subscription.data?.inputs_fields
                ? JSON.stringify(subscription.data.inputs_fields, null, 2)
                : DEFAULT_INPUTS_MAPPING,
        )
    }, [isEdit, subscription])

    // Create-mode default-bind: when opened with `defaultReferences` (e.g. from an
    // agent's config panel), pre-bind the new subscription to that workflow so the
    // user doesn't have to re-pick it. Seed `workflowRevId` from the variant ref and,
    // when present, the workflow (app) id via the selection metadata so `buildData`
    // emits the same `{application, application_variant}` shape a fresh pick would.
    useEffect(() => {
        if (isEdit) return
        const refs = state?.defaultReferences
        // Capture the app slug up front so "By environment" mode can build its
        // reference even though the default mode is "By revision".
        setAppSlug(refs?.application?.slug ?? null)
        const variantId = refs?.application_variant?.id ?? refs?.application_revision?.id ?? null
        if (!variantId) return
        const appId = refs?.application?.id ?? null
        const label = state?.defaultBoundLabel ?? appId ?? variantId
        setWorkflowRevId(variantId)
        setWorkflowLabel(label)
        setWorkflowSelection({
            type: "workflowRevision",
            id: variantId,
            label,
            path: [],
            metadata: {
                workflowId: appId ?? "",
                workflowName: state?.defaultBoundLabel ?? "",
                variantId,
                variantName: "",
                revision: 0,
            },
        })
        // Run once per open; `state` is keyed so the form remounts per drawer open.
    }, [isEdit])

    const selectedConnection = useMemo<TriggerConnection | undefined>(
        () => connections.find((c) => c.id === connectionId),
        [connections, connectionId],
    )

    const integrationKey = selectedConnection?.integration_key ?? ""

    // trigger_config schema for the chosen event (catalog detail).
    const {event: eventDetail, isLoading: eventLoading} = useTriggerEvent(integrationKey, eventKey)
    const triggerConfigSchema = (eventDetail?.trigger_config ?? null) as Record<
        string,
        unknown
    > | null

    // Seed the config form with existing trigger_config on edit.
    useEffect(() => {
        if (isEdit && subscription?.data?.trigger_config) {
            configForm.setFieldsValue(subscription.data.trigger_config)
        }
    }, [isEdit, subscription, configForm])

    // Build the subscription `data` from the form. `requireBinding` is false for
    // Test (which captures the raw event without a bound workflow) and true for
    // Save (production needs a resolvable reference + selector). Returns null on a
    // validation failure (after surfacing the message).
    const buildData = useCallback(
        async (requireBinding: boolean): Promise<TriggerSubscriptionData | null> => {
            if (!connectionId) {
                message.error("Select a connection")
                return null
            }
            if (!eventKey) {
                message.error("Select an event")
                return null
            }
            if (requireBinding) {
                if (bindMode === "environment" && !environmentSlug) {
                    message.error("Select an environment")
                    return null
                }
                if (bindMode === "revision" && !workflowRevId) {
                    message.error("Bind a workflow")
                    return null
                }
            }

            // inputs_fields is either a JSON object (field-by-field) or a bare
            // selector string (e.g. "$" = whole context).
            let inputsFields: Record<string, unknown> | string = {}
            try {
                inputsFields = inputsText.trim() ? JSON.parse(inputsText) : {}
                setInputsError(null)
            } catch {
                setInputsError("Invalid JSON")
                message.error("inputs mapping is not valid JSON")
                return null
            }

            let triggerConfig: Record<string, unknown> | undefined
            try {
                triggerConfig = (await configFormRef.current?.getValues()) ?? undefined
            } catch {
                // form validation failed
                return null
            }

            // "By environment" binds {environment, application(slug)} — the BE resolves
            // the deployed revision. "By revision": on a fresh pick send the application
            // family by the picker's ids (leaf = variant id); without a re-pick (edit)
            // resend the stored family. The BE completes either family.
            let references: TriggerSubscriptionData["references"]
            if (bindMode === "environment") {
                references = environmentSlug
                    ? {
                          environment: {slug: environmentSlug},
                          ...(appSlug ? {application: {slug: appSlug}} : {}),
                      }
                    : undefined
            } else {
                const meta = workflowSelection?.metadata
                references = meta
                    ? {
                          ...(meta.workflowId ? {application: {id: meta.workflowId}} : {}),
                          application_variant: {id: workflowRevId as string},
                      }
                    : workflowRevId
                      ? (subscription?.data?.references ?? {
                            application_variant: {id: workflowRevId},
                        })
                      : undefined
            }

            return {
                event_key: eventKey,
                trigger_config: triggerConfig,
                inputs_fields: inputsFields,
                references,
            }
        },
        [
            connectionId,
            eventKey,
            bindMode,
            environmentSlug,
            appSlug,
            workflowRevId,
            inputsText,
            workflowSelection,
            subscription,
        ],
    )

    const handleSubmit = useCallback(async () => {
        const data = await buildData(true)
        if (!data || !connectionId) return

        try {
            if (isEdit && subscription) {
                // Full PUT — carry the whole entity, override owned fields.
                const body: TriggerSubscriptionEdit = {
                    id: subscription.id as string,
                    name: name || null,
                    description: subscription.description ?? null,
                    tags: subscription.tags ?? null,
                    meta: subscription.meta ?? null,
                    connection_id: connectionId,
                    data: {...subscription.data, ...data},
                    flags: {
                        ...(subscription.flags ?? {}),
                        is_active: enabled,
                        is_valid: isEntityValid(subscription),
                    },
                }
                const result = await edit(body)
                if (!result) {
                    message.error("Failed to update subscription")
                    return
                }
                message.success("Subscription updated")
            } else {
                const body: TriggerSubscriptionCreate = {
                    name: name || null,
                    connection_id: connectionId,
                    data,
                }
                const result = await create(body)
                if (!result) {
                    message.error("Failed to create subscription")
                    return
                }
                message.success("Subscription created")
            }
            onClose()
        } catch (error) {
            message.error(triggerApiErrorMessage(error, "Failed to save subscription"))
        }
    }, [buildData, connectionId, isEdit, subscription, name, enabled, edit, create, onClose])

    if (isEdit && subLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 flex-[1.4] flex-col overflow-hidden border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)]">
                    <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                        <Form layout="vertical">
                            <Form.Item label="Name">
                                <Input
                                    placeholder="Subscription name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </Form.Item>

                            <Form.Item label="Connection" required>
                                <Select
                                    placeholder="Select a connected integration"
                                    value={connectionId}
                                    onChange={(v) => {
                                        setConnectionId(v)
                                        setEventKey("")
                                    }}
                                    loading={connectionsLoading}
                                    disabled={isEdit}
                                    options={connections.map((c) => ({
                                        value: c.id ?? "",
                                        label: `${c.name || c.slug || c.integration_key} (${c.integration_key})`,
                                    }))}
                                />
                            </Form.Item>

                            <Form.Item label="Event" required>
                                <EventSelect
                                    integrationKey={integrationKey}
                                    value={eventKey}
                                    onChange={setEventKey}
                                    disabled={!connectionId}
                                />
                                <Typography.Text type="secondary" className="text-xs">
                                    Provider: {DEFAULT_PROVIDER}
                                    {integrationKey ? ` · ${integrationKey}` : ""}
                                </Typography.Text>
                            </Form.Item>

                            <Form.Item label="Run agent version" required>
                                <div className="flex flex-col gap-2">
                                    <Segmented
                                        value={bindMode}
                                        onChange={(v) =>
                                            setBindMode(v as "revision" | "environment")
                                        }
                                        options={[
                                            {label: "By revision", value: "revision"},
                                            {label: "By environment", value: "environment"},
                                        ]}
                                    />
                                    {bindMode === "revision" ? (
                                        <EntityPicker<WorkflowRevisionSelectionResult>
                                            variant="popover-cascader"
                                            adapter={applicationRevisionAdapter}
                                            onSelect={(selection) => {
                                                setWorkflowRevId(selection.id)
                                                setWorkflowSelection(selection)
                                                setWorkflowLabel(selection.label)
                                            }}
                                            size="small"
                                            placeholder={
                                                workflowLabel ?? "Select workflow revision"
                                            }
                                        />
                                    ) : (
                                        <>
                                            <Select
                                                placeholder="Select an environment"
                                                value={environmentSlug ?? undefined}
                                                onChange={(v) => setEnvironmentSlug(v)}
                                                loading={envQuery.isLoading}
                                                options={environments.map((e) => ({
                                                    value: e.slug,
                                                    label: e.name || e.slug,
                                                }))}
                                            />
                                            <Typography.Text
                                                type="secondary"
                                                className="!text-[11px] leading-snug"
                                            >
                                                Runs whatever revision is deployed to this
                                                environment.
                                            </Typography.Text>
                                        </>
                                    )}
                                </div>
                            </Form.Item>

                            <Divider className="!my-2" />

                            <Typography.Text strong className="text-sm">
                                Trigger configuration
                            </Typography.Text>
                            <div className="mt-2 mb-4">
                                {!eventKey ? (
                                    <Typography.Text type="secondary" className="text-xs">
                                        Select an event to configure its trigger.
                                    </Typography.Text>
                                ) : eventLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Spin />
                                    </div>
                                ) : (
                                    <SchemaForm
                                        ref={configFormRef}
                                        schema={triggerConfigSchema}
                                        form={configForm}
                                        disabled={isMutating}
                                    />
                                )}
                            </div>

                            <InputsMappingField
                                value={inputsText}
                                onChange={setInputsText}
                                error={inputsError}
                                onErrorChange={setInputsError}
                                eventPayload={
                                    (eventDetail?.payload ?? null) as Record<string, unknown> | null
                                }
                                disabled={isMutating}
                            />

                            <Form.Item label="Active">
                                <Switch checked={enabled} onChange={setEnabled} />
                            </Form.Item>
                        </Form>
                    </div>
                </div>

                <TestPlaygroundPanel
                    onClose={onClose}
                    isEdit={isEdit}
                    subscriptionId={subscriptionId}
                    playgroundEntityId={playgroundEntityId}
                    connectionId={connectionId}
                    name={name}
                    eventKey={eventKey}
                    existingName={subscription?.name ?? null}
                    buildData={buildData}
                    disabledReason={
                        alreadySubscribed
                            ? "This event already has a subscription — remove it from the Triggers list to test"
                            : null
                    }
                />
            </div>

            <Divider className="!m-0" />

            {/* Footer spans the whole drawer; it persists only — testing/running
                lives in the right panel. */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 shrink-0">
                <Tooltip
                    title={
                        alreadySubscribed
                            ? "This event already has a subscription — remove it from the Triggers list to replace"
                            : ""
                    }
                >
                    {/* span wrapper so the tooltip still shows over a disabled button */}
                    <span>
                        <Button
                            type="primary"
                            loading={isMutating}
                            disabled={alreadySubscribed}
                            onClick={handleSubmit}
                        >
                            {isEdit ? "Save" : "Create"}
                        </Button>
                    </span>
                </Tooltip>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// TestPlaygroundPanel — the drawer's right panel: capture a live event and run
// it in the playground.
//
// - Edit mode: lists the last few real deliveries (queryTriggerDeliveries) for
//   one-click replay, and "Wait for a new event" polls the live subscription's
//   own deliveries until a fresh one arrives (the sub already occupies the
//   provider slot, so a transient test sub would collide).
// - New mode: "Wait for an event" spins up a throwaway is_test subscription via
//   the /test endpoint, captures the first event, then tears it down.
//
// "Run in playground" is hidden when there is no playground (workspace settings).
// ---------------------------------------------------------------------------

function formatRelativeTime(iso?: string | null): string {
    if (!iso) return ""
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return ""
    const minutes = Math.round((Date.now() - t) / 60000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return days === 1 ? "yesterday" : `${days}d ago`
}

function deliveryInputs(delivery: TriggerDelivery): Record<string, unknown> {
    return (delivery.data?.inputs ?? delivery.data ?? {}) as Record<string, unknown>
}

function hasInputs(delivery: TriggerDelivery): boolean {
    return Object.keys(deliveryInputs(delivery)).length > 0
}

function deliveryTime(delivery: TriggerDelivery): number {
    const iso = (delivery as {created_at?: string}).created_at
    const t = iso ? new Date(iso).getTime() : NaN
    return Number.isNaN(t) ? 0 : t
}

// The deliveries endpoint isn't guaranteed newest-first, so sort by time before
// slicing — otherwise a freshly captured event can land in the middle.
function recentWithInputs(deliveries: TriggerDelivery[]): TriggerDelivery[] {
    return [...deliveries]
        .filter(hasInputs)
        .sort((a, b) => deliveryTime(b) - deliveryTime(a))
        .slice(0, 3)
}

function DeliveryCard({
    delivery,
    highlight,
    onRun,
    onView,
}: {
    delivery: TriggerDelivery
    highlight?: boolean
    onRun?: (delivery: TriggerDelivery) => void
    onView?: (delivery: TriggerDelivery) => void
}) {
    const snippet = useMemo(() => {
        const inputs = deliveryInputs(delivery)
        const msg = inputs.message
        if (typeof msg === "string" && msg.trim()) return msg
        const flat = JSON.stringify(inputs)
        return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat
    }, [delivery])
    const when = formatRelativeTime((delivery as {created_at?: string}).created_at)

    return (
        <div
            className={`flex flex-col gap-2 rounded border border-solid p-2.5 ${
                highlight
                    ? "border-[var(--ag-colorInfoBorder)] bg-[var(--ag-colorInfoBg)]"
                    : "border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]"
            }`}
        >
            <div className="flex items-center gap-1.5">
                {highlight && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                )}
                <Typography.Text className="!text-[12px] !font-medium">
                    Captured event
                </Typography.Text>
                {when && (
                    <Typography.Text type="secondary" className="!ml-auto !text-[11px]">
                        {when}
                    </Typography.Text>
                )}
            </div>
            <Typography.Text type="secondary" className="!text-[12px] break-words line-clamp-2">
                {snippet}
            </Typography.Text>
            {(onRun || onView) && (
                <div className="flex items-center gap-1">
                    {onRun && (
                        <Button icon={<Play size={13} />} onClick={() => onRun(delivery)}>
                            Run in playground
                        </Button>
                    )}
                    {onView && (
                        <Button
                            type="text"
                            icon={<Code size={13} />}
                            onClick={() => onView(delivery)}
                        >
                            View payload
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}

function TestPlaygroundPanel({
    onClose,
    isEdit,
    subscriptionId,
    playgroundEntityId,
    connectionId,
    name,
    eventKey,
    existingName,
    buildData,
    disabledReason,
}: {
    onClose: () => void
    isEdit: boolean
    subscriptionId?: string
    playgroundEntityId?: string
    connectionId?: string
    name: string
    eventKey: string
    existingName: string | null
    buildData: (requireBinding: boolean) => Promise<TriggerSubscriptionData | null>
    disabledReason: string | null
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [isTesting, setIsTesting] = useState(false)
    const [recent, setRecent] = useState<TriggerDelivery[]>([])
    const [captured, setCaptured] = useState<TriggerDelivery | null>(null)
    const [justCapturedId, setJustCapturedId] = useState<string | null>(null)
    const [viewing, setViewing] = useState<TriggerDelivery | null>(null)
    const testAbortRef = useRef<AbortController | null>(null)

    const loadRecent = useCallback(async () => {
        if (!isEdit || !subscriptionId) return
        try {
            const {deliveries} = await queryTriggerDeliveries({subscription_id: subscriptionId})
            setRecent(recentWithInputs(deliveries))
        } catch {
            // Non-fatal — the panel just shows no history.
        }
    }, [isEdit, subscriptionId])

    useEffect(() => {
        loadRecent()
    }, [loadRecent])

    // Abort an in-flight wait if the drawer closes (destroyOnClose unmounts us).
    useEffect(() => () => testAbortRef.current?.abort(), [])

    const handleTest = useCallback(async () => {
        const controller = new AbortController()
        testAbortRef.current = controller
        setIsTesting(true)
        try {
            if (isEdit) {
                if (!subscriptionId) return
                // Snapshot every existing delivery so we only surface one that
                // arrives AFTER this wait starts (the history has many).
                const {deliveries: baseline} = await queryTriggerDeliveries({
                    subscription_id: subscriptionId,
                })
                const seenIds = new Set(baseline.map((d) => d.id))
                const deadline = Date.now() + 300_000
                while (Date.now() < deadline) {
                    if (controller.signal.aborted) return
                    const {deliveries} = await queryTriggerDeliveries({
                        subscription_id: subscriptionId,
                    })
                    const fresh = deliveries.filter(hasInputs).find((d) => !seenIds.has(d.id))
                    if (fresh) {
                        setJustCapturedId(fresh.id ?? null)
                        setRecent(recentWithInputs(deliveries))
                        message.success("Captured an event")
                        return
                    }
                    await new Promise((resolve) => setTimeout(resolve, 2000))
                }
                message.info("No event arrived before the test timed out")
                return
            }

            // New mode: throwaway is_test subscription via the /test endpoint.
            const data = await buildData(false)
            if (!data || !connectionId) return
            const {delivery} = await testTriggerSubscription(
                {name: name || null, connection_id: connectionId, data},
                {signal: controller.signal},
            )
            if (delivery) {
                setCaptured(delivery)
                setJustCapturedId(delivery.id ?? null)
                message.success("Captured a test event")
            } else {
                message.info("No event arrived before the test timed out")
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                message.error(triggerApiErrorMessage(error, "Test failed"))
            }
        } finally {
            testAbortRef.current = null
            setIsTesting(false)
        }
    }, [isEdit, subscriptionId, buildData, connectionId, name])

    const handleCancel = useCallback(() => testAbortRef.current?.abort(), [])

    const runInPlayground = useCallback(
        (delivery: TriggerDelivery) => {
            if (!playgroundEntityId) return
            const label = name || existingName || eventKey || "trigger"
            const text = `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                deliveryInputs(delivery),
                null,
                2,
            )}\n\`\`\``
            setPendingRun({text, nonce: Date.now()})
            onClose()
        },
        [playgroundEntityId, name, existingName, eventKey, setPendingRun, onClose],
    )

    const cards = isEdit ? recent : captured ? [captured] : []
    const waitDisabled = !isEdit && !!disabledReason

    return (
        <div className="flex w-[340px] shrink-0 flex-col overflow-hidden bg-[var(--ag-colorFillQuaternary)]">
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4 text-sm font-medium">
                <Play size={15} />
                Test in playground
            </div>
            <div className="shrink-0 px-4 pb-2">
                {isTesting ? (
                    <Button danger block onClick={handleCancel}>
                        Cancel
                    </Button>
                ) : (
                    <Tooltip title={waitDisabled ? disabledReason : ""}>
                        <span className="block">
                            <Button
                                block
                                type="primary"
                                icon={<Lightning size={14} />}
                                disabled={waitDisabled}
                                onClick={handleTest}
                            >
                                {isEdit ? "Wait for a new event" : "Wait for an event"}
                            </Button>
                        </span>
                    </Tooltip>
                )}
            </div>

            {isTesting && (
                <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
                    <Spin size="small" />
                    <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                        Waiting for an event — trigger it from the provider now.
                    </Typography.Text>
                </div>
            )}

            {cards.length > 0 && (
                <div className="shrink-0 px-4 pb-1 pt-1 text-[11px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                    Recent events
                </div>
            )}

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 pb-4">
                {cards.length === 0 && !isTesting ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                        <Lightning size={28} className="text-[var(--ag-colorTextTertiary)]" />
                        <Typography.Text type="secondary" className="text-xs">
                            No events captured yet
                        </Typography.Text>
                        <Typography.Text className="!text-[11px] leading-snug !text-[var(--ag-colorTextTertiary)]">
                            Trigger this event from the provider and it&apos;ll appear here, ready
                            to run in the playground.
                        </Typography.Text>
                    </div>
                ) : (
                    cards.map((d) => (
                        <DeliveryCard
                            key={d.id}
                            delivery={d}
                            highlight={d.id === justCapturedId}
                            onRun={playgroundEntityId ? runInPlayground : undefined}
                            onView={setViewing}
                        />
                    ))
                )}
            </div>

            <Modal
                open={!!viewing}
                onCancel={() => setViewing(null)}
                footer={null}
                title="Event payload"
                width={640}
            >
                <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--ag-colorFillQuaternary)] p-3 text-[12px] leading-snug">
                    {viewing ? JSON.stringify(viewing.data ?? viewing, null, 2) : ""}
                </pre>
            </Modal>
        </div>
    )
}

// ---------------------------------------------------------------------------
// EventSelect — searchable dropdown of the connection's catalog events.
//
// The subscription data model binds ONE event (event_key: str), so this is a
// single-select. It loads events for the chosen integration via the shared
// catalog hook, with server-side search and scroll-to-load-more.
// ---------------------------------------------------------------------------

function EventSelect({
    integrationKey,
    value,
    onChange,
    disabled,
}: {
    integrationKey: string
    value: string
    onChange: (eventKey: string) => void
    disabled?: boolean
}) {
    const {events, isLoading, isFetchingNextPage, hasNextPage, requestMore, setSearch} =
        useTriggerCatalogEvents(integrationKey)

    // Keep the selected value visible even if it isn't in the current
    // (search-filtered / paginated) page — e.g. an edit prefilled event_key.
    const options = useMemo(() => {
        const opts = events.map((e) => ({
            value: e.key,
            label: e.name ? `${e.name} (${e.key})` : e.key,
        }))
        if (value && !opts.some((o) => o.value === value)) {
            opts.unshift({value, label: value})
        }
        return opts
    }, [events, value])

    return (
        <Select
            showSearch
            placeholder="Select an event"
            suffixIcon={<Lightning size={14} />}
            value={value || undefined}
            onChange={onChange}
            onSearch={setSearch}
            filterOption={false}
            loading={isLoading}
            disabled={disabled}
            notFoundContent={isLoading ? <Spin size="small" /> : null}
            options={options}
            onPopupScroll={(e) => {
                const t = e.currentTarget
                if (
                    hasNextPage &&
                    !isFetchingNextPage &&
                    t.scrollTop + t.offsetHeight >= t.scrollHeight - 32
                ) {
                    requestMore()
                }
            }}
        />
    )
}

// ---------------------------------------------------------------------------
// InputsMappingField — JSON editor with live selector validation + path hints.
//
// The mapping is arbitrary JSON; each leaf STRING is a selector resolved at
// delivery time against the event payload (mirrors the backend
// `resolve_target_fields`): `$...` = JSONPath, `/...` = JSON Pointer, anything
// else is a literal. We validate JSON syntax + each selector live, and preview
// what each selector resolves to against the event's sample payload.
// ---------------------------------------------------------------------------

function InputsMappingField({
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
    // Selectors resolve against the normalized context the backend builds
    // (dispatcher `_build_context`), not the raw provider payload.
    const context = useMemo(() => buildPreviewContext(eventPayload), [eventPayload])

    // Parse + validate live; collect a per-leaf resolution preview.
    const {leaves, parseError} = useMemo(() => analyzeMapping(value, context), [value, context])

    useEffect(() => {
        onErrorChange(parseError)
    }, [parseError, onErrorChange])

    const payloadKeys = useMemo(
        () =>
            Object.keys(
                (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {},
            ).map((k) => `event.attributes.${k}`),
        [context],
    )

    return (
        <Form.Item
            label="Inputs mapping"
            validateStatus={error ? "error" : undefined}
            help={error ?? "Maps event context to the workflow inputs (JSON)"}
        >
            <div className="rounded-lg border border-solid border-[var(--ag-colorBorder)] overflow-hidden">
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

            <Typography.Text type="secondary" className="!text-[11px] leading-snug block mt-1">
                String values are selectors against the event payload: <code>$.path</code>{" "}
                (JSONPath), <code>/path</code> (JSON Pointer), or a literal.
            </Typography.Text>

            {payloadKeys.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Typography.Text type="secondary" className="!text-[11px]">
                        Available:
                    </Typography.Text>
                    {payloadKeys.slice(0, 12).map((k) => (
                        <code
                            key={k}
                            className="text-[11px] px-1 rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorText)]"
                        >
                            $.{k}
                        </code>
                    ))}
                    {payloadKeys.length > 12 && (
                        <Typography.Text type="secondary" className="!text-[11px]">
                            +{payloadKeys.length - 12} more
                        </Typography.Text>
                    )}
                </div>
            )}

            {!parseError && leaves.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                    {leaves.map((leaf, i) => (
                        <div
                            key={`${leaf.key}-${i}`}
                            className="flex items-center gap-1.5 text-[11px] leading-snug"
                        >
                            <code className="text-[var(--ag-colorTextSecondary)]">{leaf.key}</code>
                            <span className="text-[var(--ag-colorTextTertiary)]">→</span>
                            {leaf.isSelector ? (
                                leaf.resolved === undefined ? (
                                    <Typography.Text type="warning" className="!text-[11px]">
                                        no sample value
                                    </Typography.Text>
                                ) : (
                                    <code className="text-[var(--ag-colorSuccess)] truncate max-w-[280px]">
                                        {leaf.resolved}
                                    </code>
                                )
                            ) : (
                                <Typography.Text type="secondary" className="!text-[11px]">
                                    literal
                                </Typography.Text>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Form.Item>
    )
}

// ---------------------------------------------------------------------------
// Mapping analysis + lightweight selector resolution (preview only).
//
// Full JSONPath/Pointer evaluation happens server-side; here we resolve the
// common dot/bracket and pointer forms just to show a "resolves to" preview.
// Anything we can't resolve shows as "no sample value" (never a hard error).
// ---------------------------------------------------------------------------

interface MappingLeaf {
    key: string
    isSelector: boolean
    resolved?: string
}

// Mirror of the backend dispatcher `_build_context`: the raw provider payload
// becomes `event.attributes`, alongside the synthetic event fields. Selectors in
// the mapping resolve against this shape, so previews match delivery.
function buildPreviewContext(payload: Record<string, unknown> | null): Record<string, unknown> {
    return {
        event: {
            event_id: "evt_…",
            event_type: "…",
            timestamp: "…",
            created_at: "…",
            attributes: payload ?? {},
        },
    }
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
    // A bare selector string at top level maps the whole resolution to the inputs.
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
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof raw !== "string") {
            leaves.push({key, isSelector: false})
            continue
        }
        const isSelector = raw.startsWith("$") || raw.startsWith("/")
        if (!isSelector) {
            leaves.push({key, isSelector: false})
            continue
        }
        const resolved = context ? resolveSelectorPreview(raw, context) : undefined
        leaves.push({
            key,
            isSelector: true,
            resolved: resolved === undefined ? undefined : previewValue(resolved),
        })
    }
    return {leaves, parseError: null}
}
