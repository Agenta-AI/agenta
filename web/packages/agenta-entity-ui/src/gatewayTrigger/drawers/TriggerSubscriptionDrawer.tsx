import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    isEntityActive,
    isEntityValid,
    previewValue,
    resolveSelectorPreview,
    testTriggerSubscription,
    triggerApiErrorMessage,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogEvents,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerSubscription,
    type TriggerConnection,
    type TriggerDelivery,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {Editor} from "@agenta/ui/editor"
import {Lightning} from "@phosphor-icons/react"
import {Button, Divider, Drawer, Form, Input, Select, Spin, Switch, Typography, message} from "antd"
import {useAtom} from "jotai"

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
            width={640}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
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
    const [eventKey, setEventKey] = useState("")
    const [enabled, setEnabled] = useState(true)
    const [workflowRevId, setWorkflowRevId] = useState<string | null>(null)
    const [workflowSelection, setWorkflowSelection] =
        useState<WorkflowRevisionSelectionResult | null>(null)
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
    // Default maps the whole event context under `context` so a fresh test shows
    // everything; `$` resolves to the full resolution context.
    const [inputsText, setInputsText] = useState(DEFAULT_INPUTS_MAPPING)
    const [inputsError, setInputsError] = useState<string | null>(null)

    // Test = fire-and-inspect: create a transient is_test subscription, wait for
    // the first captured event, show it. Independent of Save (separate row, torn
    // down server-side). The binding is NOT required to test.
    const [isTesting, setIsTesting] = useState(false)
    const [testResult, setTestResult] = useState<TriggerDelivery | null>(null)
    const testAbortRef = useRef<AbortController | null>(null)

    const [configForm] = Form.useForm()
    const configFormRef = useRef<SchemaFormHandle>(null)

    // Prefill from the freshly-fetched subscription (edit mode).
    useEffect(() => {
        if (!isEdit || !subscription) return
        setName(subscription.name ?? "")
        setConnectionId(subscription.connection_id)
        setEventKey(subscription.data?.event_key ?? "")
        setEnabled(isEntityActive(subscription))
        const wfId =
            subscription.data?.references?.application_revision?.id ??
            subscription.data?.references?.workflow_revision?.id ??
            null
        setWorkflowRevId(wfId)
        setWorkflowLabel(wfId)
        setInputsText(
            subscription.data?.inputs_fields
                ? JSON.stringify(subscription.data.inputs_fields, null, 2)
                : DEFAULT_INPUTS_MAPPING,
        )
    }, [isEdit, subscription])

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
            if (requireBinding && !workflowRevId) {
                message.error("Bind a workflow")
                return null
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

            // On a fresh pick, send the application family by the picker's ids (its
            // leaf is the variant id). Without a re-pick (edit), resend the stored
            // already-complete references. The BE completes the family either way.
            const meta = workflowSelection?.metadata
            const references = meta
                ? {
                      ...(meta.workflowId ? {application: {id: meta.workflowId}} : {}),
                      application_variant: {id: workflowRevId},
                  }
                : workflowRevId
                  ? (subscription?.data?.references ?? {application_variant: {id: workflowRevId}})
                  : undefined

            return {
                event_key: eventKey,
                trigger_config: triggerConfig,
                inputs_fields: inputsFields,
                references,
            }
        },
        [connectionId, eventKey, workflowRevId, inputsText, workflowSelection, subscription],
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

    // Fire-and-inspect: the /test endpoint creates an is_test subscription,
    // long-polls for the first captured event, then tears it down server-side.
    // The drawer stays open; re-clicking runs another capture.
    const handleTest = useCallback(async () => {
        const data = await buildData(false)
        if (!data || !connectionId) return

        const controller = new AbortController()
        testAbortRef.current = controller
        setIsTesting(true)
        setTestResult(null)
        try {
            const {delivery} = await testTriggerSubscription(
                {name: name || null, connection_id: connectionId, data},
                {signal: controller.signal},
            )
            if (delivery) {
                setTestResult(delivery)
                message.success("Captured a test event")
            } else {
                message.info("No event arrived before the test timed out")
            }
        } catch (error) {
            // A user-initiated cancel isn't an error; the server tears the test
            // subscription down regardless of the dropped request.
            if (!controller.signal.aborted) {
                message.error(triggerApiErrorMessage(error, "Test failed"))
            }
        } finally {
            testAbortRef.current = null
            setIsTesting(false)
        }
    }, [buildData, connectionId, name])

    const handleCancelTest = useCallback(() => {
        testAbortRef.current?.abort()
    }, [])

    if (isEdit && subLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
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

                    <Form.Item label="Bound workflow" required>
                        <div className="flex items-center gap-2">
                            <EntityPicker<WorkflowRevisionSelectionResult>
                                variant="popover-cascader"
                                adapter={applicationRevisionAdapter}
                                onSelect={(selection) => {
                                    setWorkflowRevId(selection.id)
                                    setWorkflowSelection(selection)
                                    setWorkflowLabel(selection.label)
                                }}
                                size="small"
                                placeholder={workflowLabel ?? "Select workflow revision"}
                            />
                            {workflowLabel && (
                                <Typography.Text type="secondary" className="text-xs truncate">
                                    {workflowLabel}
                                </Typography.Text>
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

                    <CapturedEventField result={testResult} isTesting={isTesting} />
                </Form>
            </div>

            <Divider className="!m-0" />

            <div className="flex items-center justify-between gap-2 px-6 py-3 shrink-0">
                {isTesting ? (
                    <Button danger onClick={handleCancelTest}>
                        Cancel
                    </Button>
                ) : (
                    <Button disabled={isMutating} onClick={handleTest}>
                        Test
                    </Button>
                )}
                <Button
                    type="primary"
                    loading={isMutating}
                    disabled={isTesting}
                    onClick={handleSubmit}
                >
                    {isEdit ? "Save" : "Create"}
                </Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// CapturedEventField — shows the event the Test button captured.
//
// While a test is in flight it prompts the user to trigger the event from the
// provider; once a delivery lands it pretty-prints the captured context
// (delivery.data.inputs — the resolved `$` event by default).
// ---------------------------------------------------------------------------

function CapturedEventField({
    result,
    isTesting,
}: {
    result: TriggerDelivery | null
    isTesting: boolean
}) {
    if (!isTesting && !result) return null

    return (
        <Form.Item label="Captured event">
            {isTesting ? (
                <div className="flex items-center gap-2">
                    <Spin size="small" />
                    <Typography.Text type="secondary" className="text-xs">
                        Waiting for an event — trigger it from the provider now.
                    </Typography.Text>
                </div>
            ) : (
                <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-auto max-h-[240px] p-2">
                    <pre className="text-[11px] leading-snug whitespace-pre-wrap break-words m-0">
                        {JSON.stringify(result?.data?.inputs ?? result?.data ?? {}, null, 2)}
                    </pre>
                </div>
            )}
        </Form.Item>
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
            <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
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
                            className="text-[11px] px-1 rounded bg-gray-100 dark:bg-gray-800"
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
                            <code className="text-gray-500">{leaf.key}</code>
                            <span className="text-gray-400">→</span>
                            {leaf.isSelector ? (
                                leaf.resolved === undefined ? (
                                    <Typography.Text type="warning" className="!text-[11px]">
                                        no sample value
                                    </Typography.Text>
                                ) : (
                                    <code className="text-green-600 dark:text-green-400 truncate max-w-[280px]">
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
