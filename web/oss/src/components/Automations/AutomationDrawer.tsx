import {createElement, useCallback, useEffect, useMemo, useState} from "react"

import {BookOpen} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, message, Select, Tabs, Tooltip, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    AutomationProvider,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/automations/types"
import {
    createAutomationAtom,
    testAutomationAtom,
    updateAutomationAtom,
} from "@/oss/state/automations/atoms"
import {
    createdWebhookSecretAtom,
    editingAutomationAtom,
    isAutomationDrawerOpenAtom,
    selectedProviderAtom,
} from "@/oss/state/automations/state"

import {AUTOMATION_SCHEMA, EVENT_OPTIONS} from "./assets/constants"
import {AutomationFieldRenderer} from "./AutomationFieldRenderer"
import AutomationLogsTab from "./AutomationLogsTab"
import {RequestPreview} from "./RequestPreview"
import {buildSubscription} from "./utils/buildSubscription"
import {AUTOMATION_TEST_FAILURE_MESSAGE, handleTestResult} from "./utils/handleTestResult"

const AutomationDrawer = ({onSuccess}: {onSuccess: () => void}) => {
    const [form] = Form.useForm()
    const [open, setOpen] = useAtom(isAutomationDrawerOpenAtom)
    const [initialValues, setEditingWebhook] = useAtom(editingAutomationAtom)
    const [activeTab, setActiveTab] = useState("configuration")
    const [isTesting, setIsTesting] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const setCreatedWebhookSecret = useSetAtom(createdWebhookSecretAtom)
    const [selectedProvider, setSelectedProvider] = useAtom(selectedProviderAtom)

    const createAutomation = useSetAtom(createAutomationAtom)
    const testAutomation = useSetAtom(testAutomationAtom)
    const updateAutomation = useSetAtom(updateAutomationAtom)

    const isEdit = !!initialValues

    const onCancel = useCallback(() => {
        setOpen(false)
        setEditingWebhook(undefined)
    }, [setOpen, setEditingWebhook])

    useEffect(() => {
        if (!open) {
            setActiveTab("configuration")
            form.resetFields()
            return
        }

        setActiveTab("configuration")

        if (initialValues) {
            // Determine provider via heuristic since no meta field is stored.
            let isGitHub = false
            try {
                const parsedUrl = new URL(initialValues.data.url)
                isGitHub = parsedUrl.hostname === "api.github.com"
            } catch {
                isGitHub = false
            }
            const provider: AutomationProvider = isGitHub ? "github" : "webhook"
            setSelectedProvider(provider)

            // Map the headers from Record<string, string> back to Antd Form.List [{key, value}]
            let header_list: {key: string; value: string}[] = []
            if (initialValues.data.headers && Object.keys(initialValues.data.headers).length > 0) {
                const isSystemHeader = (k: string) =>
                    isGitHub &&
                    (k === "Accept" || k === "X-GitHub-Api-Version" || k === "Authorization")
                header_list = Object.entries(initialValues.data.headers)
                    .filter(([k, _v]) => !isSystemHeader(k))
                    .map(([k, v]) => ({key: k, value: String(v)}))
            }

            // Derive GitHub properties if needed
            let github_sub_type = "repository_dispatch"
            let github_repo = ""
            let github_workflow = ""
            let github_branch = "main"

            if (isGitHub) {
                const repoMatch = initialValues.data.url.match(/repos\/([^\/]+\/[^\/]+)\//)
                if (repoMatch) github_repo = repoMatch[1]

                if (initialValues.data.url.includes("/actions/workflows/")) {
                    github_sub_type = "workflow_dispatch"
                    const workflowMatch = initialValues.data.url.match(
                        /workflows\/([^\/]+)\/dispatches/,
                    )
                    if (workflowMatch) github_workflow = workflowMatch[1]

                    if (initialValues.data.payload_fields?.ref) {
                        github_branch = initialValues.data.payload_fields.ref as string
                    }
                }
            }

            form.setFieldsValue({
                provider,
                name: initialValues.name,
                events: initialValues.data.event_types || [],
                url: isGitHub ? undefined : initialValues.data.url,
                header_list,
                auth_mode: initialValues.data.auth_mode || "signature",
                github_sub_type,
                github_repo,
                github_workflow,
                github_branch,
            })
        } else {
            form.resetFields()
            setSelectedProvider("webhook")
            form.setFieldsValue({
                provider: "webhook",
                events: ["environments.revisions.committed"],
                auth_mode: "signature",
                github_sub_type: "repository_dispatch",
            })
        }
    }, [open, initialValues, form])

    const buildPayloadFromForm = useCallback(async () => {
        const rawValues = await form.validateFields()

        let headersRecord: Record<string, string> | undefined = undefined
        if (rawValues.header_list && rawValues.header_list.length > 0) {
            headersRecord = {}
            rawValues.header_list.forEach((h: {key: string; value: string}) => {
                if (h.key && h.value && headersRecord) {
                    headersRecord[h.key] = h.value
                }
            })
        }

        const processedValues = {
            ...rawValues,
            headers: headersRecord,
            event_types: rawValues.events,
        }

        return {
            rawValues,
            payload: buildSubscription(processedValues, isEdit, initialValues?.id),
        }
    }, [form, initialValues?.id, isEdit])

    const handleTestConnection = useCallback(async () => {
        if (!open) return

        try {
            setIsTesting(true)
            const {payload} = await buildPayloadFromForm()
            const response = await testAutomation(payload)
            handleTestResult(response)
        } catch (error) {
            if ((error as {errorFields?: unknown}).errorFields) return
            console.error(error)
            message.error(AUTOMATION_TEST_FAILURE_MESSAGE, 10)
        } finally {
            setIsTesting(false)
        }
    }, [buildPayloadFromForm, open, testAutomation])

    const handleOk = useCallback(async () => {
        try {
            setIsSubmitting(true)
            const {rawValues, payload} = await buildPayloadFromForm()
            let subscriptionId: string | undefined
            let testPayload:
                | WebhookSubscriptionCreateRequest
                | WebhookSubscriptionEditRequest
                | undefined

            if (isEdit && initialValues?.id) {
                await updateAutomation({
                    webhookSubscriptionId: initialValues.id,
                    payload: payload as WebhookSubscriptionEditRequest,
                })
                subscriptionId = initialValues.id
                testPayload = {
                    subscription: {
                        ...(payload as WebhookSubscriptionEditRequest).subscription,
                        id: initialValues.id,
                    },
                }
                message.success("Automation updated successfully")
            } else {
                const response = await createAutomation(payload as WebhookSubscriptionCreateRequest)
                subscriptionId = response.subscription?.id
                const webhookSecret =
                    response.subscription?.secret || response.subscription?.secret_id

                const isSignatureWebhook =
                    selectedProvider === "webhook" && rawValues.auth_mode === "signature"

                if (isSignatureWebhook && webhookSecret) {
                    setCreatedWebhookSecret(webhookSecret)
                }

                if (response.subscription) {
                    testPayload = {
                        subscription: {
                            id: response.subscription.id,
                            name: response.subscription.name,
                            description: response.subscription.description,
                            data: response.subscription.data,
                        },
                    }
                }

                message.success("Automation created successfully")
            }

            onSuccess()
            onCancel()

            if (subscriptionId && testPayload) {
                try {
                    const response = await testAutomation(testPayload)
                    handleTestResult(response)
                } catch (error) {
                    console.error(error)
                    message.warning(
                        "Automation saved, but the connection test could not complete. You can retry it from the drawer or table.",
                        10,
                    )
                }
            }
        } catch (error) {
            if ((error as {errorFields?: unknown}).errorFields) return
            console.error(error)
            message.error(isEdit ? "Failed to update automation" : "Failed to create automation")
        } finally {
            setIsSubmitting(false)
        }
    }, [
        form,
        isEdit,
        initialValues,
        onSuccess,
        onCancel,
        setCreatedWebhookSecret,
        buildPayloadFromForm,
        createAutomation,
        testAutomation,
        updateAutomation,
        selectedProvider,
    ])

    const providerOptions = useMemo(
        () =>
            AUTOMATION_SCHEMA.map((provider) => ({
                label: (
                    <div className="flex items-center gap-2">
                        {createElement(provider.icon)}
                        <span>{provider.label}</span>
                    </div>
                ),
                value: provider.provider,
            })),
        [],
    )

    const selectedProviderConfig = useMemo(
        () => AUTOMATION_SCHEMA.find((s) => s.provider === selectedProvider),
        [selectedProvider],
    )

    const docsUrl =
        selectedProvider === "github"
            ? "https://agenta.ai/docs/prompt-engineering/integrating-prompts/github"
            : "https://agenta.ai/docs/prompt-engineering/integrating-prompts/webhooks"

    const drawerTabs = useMemo(
        () => [
            {
                key: "configuration",
                label: "Configuration",
                children: (
                    <div className="flex flex-col gap-3">
                        <div className="mb-4 text-gray-500">
                            Set up an automation to trigger external services when specific events
                            occur within Agenta.
                        </div>

                        <Form
                            form={form}
                            layout="vertical"
                            requiredMark={false}
                            onValuesChange={(changedValues) => {
                                if (changedValues.provider) {
                                    setSelectedProvider(changedValues.provider)
                                }
                            }}
                        >
                            <div className="flex flex-col gap-3">
                                <Form.Item
                                    name="provider"
                                    label="Webhook Type"
                                    initialValue="webhook"
                                    className="!mb-0"
                                >
                                    <Select
                                        disabled={isEdit}
                                        options={providerOptions}
                                        placeholder="Select webhook/github"
                                    />
                                </Form.Item>

                                <Form.Item
                                    name="name"
                                    label="Webhook Name"
                                    className="!mb-0"
                                    rules={[{required: true, message: "Please enter a name"}]}
                                >
                                    <Input placeholder="Production deploy hook" />
                                </Form.Item>

                                <Form.Item
                                    name="events"
                                    label="Event Types"
                                    className="!mb-0"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please select at least one event",
                                        },
                                    ]}
                                >
                                    <Select
                                        mode="multiple"
                                        placeholder="Select events"
                                        options={EVENT_OPTIONS}
                                    />
                                </Form.Item>

                                {selectedProviderConfig && (
                                    <>
                                        <div className="mt-4 mb-2">
                                            <Typography.Text
                                                type="secondary"
                                                className="font-medium"
                                            >
                                                {selectedProviderConfig.subtitle}
                                            </Typography.Text>
                                        </div>
                                        <AutomationFieldRenderer
                                            fields={selectedProviderConfig.fields}
                                            isEditMode={isEdit}
                                        />
                                    </>
                                )}

                                <Collapse
                                    className="[&_.ant-collapse-content]:bg-transparent"
                                    size="small"
                                >
                                    <Collapse.Panel
                                        header="Example Request"
                                        key="preview"
                                        forceRender
                                    >
                                        <RequestPreview form={form} />
                                    </Collapse.Panel>
                                </Collapse>
                            </div>
                        </Form>
                    </div>
                ),
            },
            ...(initialValues?.id
                ? [
                      {
                          key: "logs",
                          label: "Logs",
                          children:
                              activeTab === "logs" ? (
                                  <AutomationLogsTab subscriptionId={initialValues.id} />
                              ) : null,
                      },
                  ]
                : []),
        ],
        [
            activeTab,
            form,
            initialValues?.id,
            isEdit,
            providerOptions,
            selectedProviderConfig,
            setSelectedProvider,
        ],
    )

    return (
        <>
            <EnhancedDrawer
                title={isEdit ? "Edit Automation" : "Add Automation"}
                extra={
                    <Tooltip title="Documentation">
                        <Button
                            type="text"
                            size="small"
                            icon={<BookOpen size={16} />}
                            href={docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open automation documentation"
                        />
                    </Tooltip>
                }
                open={open}
                onClose={onCancel}
                width={840}
                destroyOnHidden
                footer={
                    <div className="flex items-center justify-between gap-2">
                        <Button onClick={onCancel}>Cancel</Button>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleTestConnection}
                                loading={isTesting}
                                disabled={isSubmitting}
                            >
                                Test Connection
                            </Button>
                            <Button type="primary" onClick={handleOk} loading={isSubmitting}>
                                {isEdit ? "Update Automation" : "Create Automation"}
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="h-full min-h-0 [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:h-full [&_.ant-tabs-tabpane]:h-full">
                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={drawerTabs}
                        className="h-full"
                    />
                </div>
            </EnhancedDrawer>
        </>
    )
}

export default AutomationDrawer
