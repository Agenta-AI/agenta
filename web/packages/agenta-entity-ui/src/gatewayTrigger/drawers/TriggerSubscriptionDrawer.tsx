import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    subscriptionDrawerAtom,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerSubscription,
    type TriggerConnection,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Lightning} from "@phosphor-icons/react"
import {Button, Divider, Drawer, Form, Input, Select, Spin, Switch, Typography, message} from "antd"
import {useAtom} from "jotai"

import SchemaForm, {type SchemaFormHandle} from "../../gatewayTool/components/SchemaForm"
import {
    EntityPicker,
    workflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "../../selection"

const DEFAULT_PROVIDER = "composio"

// ---------------------------------------------------------------------------
// TriggerSubscriptionDrawer (root) — create or edit a subscription.
//
// Binds a provider event (catalog) on a connected integration to a workflow
// revision. Edits are full-PUT: the body is sourced from the freshly-fetched
// subscription and only owned fields are overridden.
// ---------------------------------------------------------------------------

export default function TriggerSubscriptionDrawer() {
    const [state, setState] = useAtom(subscriptionDrawerAtom)
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
    const [state] = useAtom(subscriptionDrawerAtom)
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
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
    const [inputsText, setInputsText] = useState("{}")
    const [inputsError, setInputsError] = useState<string | null>(null)

    const [configForm] = Form.useForm()
    const configFormRef = useRef<SchemaFormHandle>(null)

    // Prefill from the freshly-fetched subscription (edit mode).
    useEffect(() => {
        if (!isEdit || !subscription) return
        setName(subscription.name ?? "")
        setConnectionId(subscription.connection_id)
        setEventKey(subscription.data?.event_key ?? "")
        setEnabled(subscription.enabled ?? true)
        const wfId = subscription.data?.references?.workflow_revision?.id ?? null
        setWorkflowRevId(wfId)
        setWorkflowLabel(wfId)
        setInputsText(JSON.stringify(subscription.data?.inputs_fields ?? {}, null, 2))
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

    const handleSubmit = useCallback(async () => {
        if (!connectionId) {
            message.error("Select a connection")
            return
        }
        if (!eventKey) {
            message.error("Select an event")
            return
        }
        if (!workflowRevId) {
            message.error("Bind a workflow")
            return
        }

        let inputsFields: Record<string, unknown> = {}
        try {
            inputsFields = inputsText.trim() ? JSON.parse(inputsText) : {}
            setInputsError(null)
        } catch {
            setInputsError("Invalid JSON")
            message.error("inputs mapping is not valid JSON")
            return
        }

        let triggerConfig: Record<string, unknown> | undefined
        try {
            triggerConfig = (await configFormRef.current?.getValues()) ?? undefined
        } catch {
            // form validation failed
            return
        }

        const data: TriggerSubscriptionData = {
            event_key: eventKey,
            trigger_config: triggerConfig,
            inputs_fields: inputsFields,
            references: {workflow_revision: {id: workflowRevId}},
        }

        try {
            if (isEdit && subscription) {
                // Full PUT — carry the whole entity, override owned fields.
                const body: TriggerSubscriptionEdit = {
                    id: subscription.id as string,
                    name: name || null,
                    description: subscription.description ?? null,
                    flags: subscription.flags ?? null,
                    tags: subscription.tags ?? null,
                    meta: subscription.meta ?? null,
                    connection_id: connectionId,
                    data: {...subscription.data, ...data},
                    enabled,
                    valid: subscription.valid ?? true,
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
        } catch {
            message.error("Failed to save subscription")
        }
    }, [
        connectionId,
        eventKey,
        workflowRevId,
        inputsText,
        isEdit,
        subscription,
        name,
        enabled,
        edit,
        create,
        onClose,
    ])

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
                        <Input
                            placeholder="Event key (e.g. github_star_added_event)"
                            prefix={<Lightning size={14} />}
                            value={eventKey}
                            onChange={(e) => setEventKey(e.target.value)}
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
                                adapter={workflowRevisionAdapter}
                                onSelect={(selection) => {
                                    setWorkflowRevId(selection.id)
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
                        {eventLoading ? (
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

                    <Form.Item
                        label="Inputs mapping"
                        validateStatus={inputsError ? "error" : undefined}
                        help={inputsError ?? "Maps event context to the workflow inputs (JSON)"}
                    >
                        <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
                            <Editor
                                initialValue={inputsText || "{}"}
                                onChange={({textContent}) => setInputsText(textContent)}
                                codeOnly
                                showToolbar={false}
                                language="json"
                                dimensions={{width: "100%", height: 120}}
                                disabled={isMutating}
                            />
                        </div>
                    </Form.Item>

                    <Form.Item label="Enabled">
                        <Switch checked={enabled} onChange={setEnabled} />
                    </Form.Item>
                </Form>
            </div>

            <Divider className="!m-0" />

            <div className="flex justify-end gap-2 px-6 py-3 shrink-0">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary" loading={isMutating} onClick={handleSubmit}>
                    {isEdit ? "Save" : "Create"}
                </Button>
            </div>
        </div>
    )
}
