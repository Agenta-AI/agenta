import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
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
import {Lightning, Play} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Drawer,
    Form,
    Input,
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
            width={560}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", overflow: "hidden"},
            }}
        >
            {state && (
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <SubscriptionForm key={state.subscriptionId ?? "new"} onClose={handleClose} />
                </div>
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

    // "Run in playground": channel a captured test event into the agent's active
    // chat session (keyed by the playground entityId) so the draft agent runs and
    // streams there. Only available when the drawer was opened from a playground.
    const playgroundEntityId = state?.playgroundEntityId
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))

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

    // Clear the wait if the drawer closes mid-test (the form unmounts via
    // destroyOnClose) — abort the in-flight long-poll so it doesn't linger.
    useEffect(() => {
        return () => {
            testAbortRef.current?.abort()
        }
    }, [])

    const handleCancelTest = useCallback(() => {
        testAbortRef.current?.abort()
    }, [])

    const handleRunInPlayground = useCallback(() => {
        if (!playgroundEntityId || !testResult) return
        const inputs = testResult.data?.inputs ?? testResult.data ?? {}
        const label = name || subscription?.name || eventKey || "trigger"
        const text = `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
            inputs,
            null,
            2,
        )}\n\`\`\``
        setPendingRun({text, nonce: Date.now()})
        onClose()
    }, [playgroundEntityId, testResult, name, subscription, eventKey, setPendingRun, onClose])

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

                    <Form.Item label="Run agent version" required>
                        <div className="flex flex-col gap-2">
                            <Segmented
                                value={bindMode}
                                onChange={(v) => setBindMode(v as "revision" | "environment")}
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
                                    placeholder={workflowLabel ?? "Select workflow revision"}
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
                                        Runs whatever revision is deployed to this environment.
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

                    <CapturedEventField
                        result={testResult}
                        isTesting={isTesting}
                        onRunInPlayground={playgroundEntityId ? handleRunInPlayground : undefined}
                    />
                </Form>
            </div>

            <Divider className="!m-0" />

            <div className="flex items-center justify-between gap-2 px-6 py-3 shrink-0">
                {isTesting ? (
                    <Button danger onClick={handleCancelTest}>
                        Cancel
                    </Button>
                ) : (
                    <Tooltip
                        title={alreadySubscribed ? "Already subscribed — revoke it to test" : ""}
                    >
                        {/* span wrapper so the tooltip still shows over a disabled button */}
                        <span>
                            <Button disabled={isMutating || alreadySubscribed} onClick={handleTest}>
                                Test
                            </Button>
                        </span>
                    </Tooltip>
                )}
                <Tooltip
                    title={alreadySubscribed ? "Already subscribed — revoke it to replace" : ""}
                >
                    {/* span wrapper so the tooltip still shows over a disabled button */}
                    <span>
                        <Button
                            type="primary"
                            loading={isMutating}
                            disabled={isTesting || alreadySubscribed}
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
// CapturedEventField — shows the event the Test button captured.
//
// While a test is in flight it prompts the user to trigger the event from the
// provider; once a delivery lands it pretty-prints the captured context
// (delivery.data.inputs — the resolved `$` event by default).
// ---------------------------------------------------------------------------

function CapturedEventField({
    result,
    isTesting,
    onRunInPlayground,
}: {
    result: TriggerDelivery | null
    isTesting: boolean
    /** When set, show a "Run in playground" action that channels this event into the chat. */
    onRunInPlayground?: () => void
}) {
    if (!isTesting && !result) return null

    return (
        <Form.Item label={isTesting ? "Waiting for an event" : "Captured event"}>
            {isTesting ? (
                <div className="flex items-center gap-2">
                    <Spin size="small" />
                    <Typography.Text type="secondary" className="text-xs">
                        Waiting for an event — trigger it from the provider now.
                    </Typography.Text>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <div className="rounded-lg border border-solid border-[var(--ag-colorBorder)] overflow-auto max-h-[240px] p-2">
                        <pre className="text-[11px] leading-snug whitespace-pre-wrap break-words m-0">
                            {JSON.stringify(result?.data?.inputs ?? result?.data ?? {}, null, 2)}
                        </pre>
                    </div>
                    {onRunInPlayground && (
                        <div>
                            <Button
                                type="primary"
                                icon={<Play size={14} />}
                                onClick={onRunInPlayground}
                            >
                                Run in playground
                            </Button>
                            <Typography.Text type="secondary" className="ml-2 !text-[11px]">
                                Runs the current agent with this event in the active session.
                            </Typography.Text>
                        </div>
                    )}
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
