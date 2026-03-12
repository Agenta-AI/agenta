import {createElement, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Collapse, Form, Input, message, Select, Tooltip, Typography} from "antd"
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
import {RequestPreview} from "./RequestPreview"
import {buildSubscription} from "./utils/buildSubscription"
import {handleTestResult} from "./utils/handleTestResult"

const AutomationDrawer = ({onSuccess}: {onSuccess: () => void}) => {
    const [form] = Form.useForm()
    const [open, setOpen] = useAtom(isAutomationDrawerOpenAtom)
    const [initialValues, setEditingWebhook] = useAtom(editingAutomationAtom)
    const [isTesting, setIsTesting] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const setCreatedWebhookSecret = useSetAtom(createdWebhookSecretAtom)
    const [selectedProvider, setSelectedProvider] = useAtom(selectedProviderAtom)

    const createAutomation = useSetAtom(createAutomationAtom)
    const updateAutomation = useSetAtom(updateAutomationAtom)
    const testAutomation = useSetAtom(testAutomationAtom)

    const isEdit = !!initialValues

    const onCancel = useCallback(() => {
        setOpen(false)
        setEditingWebhook(undefined)
    }, [setOpen, setEditingWebhook])

    useEffect(() => {
        if (!open) {
            form.resetFields()
            return
        }

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

    const handleTestConnection = useCallback(async () => {
        if (!initialValues?.id) return

        try {
            setIsTesting(true)
            const response = await testAutomation(initialValues.id)
            handleTestResult(response)
        } catch (error) {
            console.error(error)
            message.error(error instanceof Error ? error.message : "Failed to test connection")
        } finally {
            setIsTesting(false)
        }
    }, [initialValues?.id, testAutomation])

    const handleOk = useCallback(async () => {
        try {
            const rawValues = await form.validateFields()
            setIsSubmitting(true)

            // Map the Form.List array back to Record<string, string>
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

            const payload = buildSubscription(processedValues, isEdit, initialValues?.id)

            if (isEdit && initialValues?.id) {
                await updateAutomation({
                    webhookSubscriptionId: initialValues.id,
                    payload: payload as WebhookSubscriptionEditRequest,
                })
                message.success("Automation updated successfully")
            } else {
                const response = await createAutomation(payload as WebhookSubscriptionCreateRequest)
                const webhookSecret =
                    response.subscription?.secret || response.subscription?.secret_id

                const isSignatureWebhook =
                    selectedProvider === "webhook" && rawValues.auth_mode === "signature"

                if (isSignatureWebhook && webhookSecret) {
                    setCreatedWebhookSecret(webhookSecret)
                }

                message.success("Automation created successfully")
            }
            onSuccess()
            onCancel()
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
        createAutomation,
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

    return (
        <>
            <EnhancedDrawer
                title={isEdit ? "Edit Automation" : "Add Automation"}
                open={open}
                onClose={onCancel}
                width={450}
                destroyOnHidden
                footer={
                    <div className="flex items-center justify-between gap-2">
                        <Button onClick={onCancel}>Cancel</Button>
                        <div className="flex items-center gap-2">
                            <Tooltip
                                title={
                                    isEdit
                                        ? "Test this automation"
                                        : "You must save the automation before testing it"
                                }
                            >
                                <Button
                                    loading={isTesting}
                                    onClick={handleTestConnection}
                                    disabled={!isEdit}
                                >
                                    Test Automation
                                </Button>
                            </Tooltip>
                            <Button type="primary" onClick={handleOk} loading={isSubmitting}>
                                {isEdit ? "Update Automation" : "Create Automation"}
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="mb-4 text-gray-500">
                    Set up an automation to trigger external services when specific events occur
                    within Agenta.
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
                            label="Destination"
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
                            label="Name"
                            className="!mb-0"
                            rules={[{required: true, message: "Please enter a name"}]}
                        >
                            <Input placeholder="Production deploy hook" />
                        </Form.Item>

                        <Form.Item
                            name="events"
                            label="Event types"
                            className="!mb-0"
                            rules={[{required: true, message: "Please select at least one event"}]}
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
                                    <Typography.Text type="secondary" className="font-medium">
                                        {selectedProviderConfig.subtitle}
                                    </Typography.Text>
                                </div>
                                <AutomationFieldRenderer
                                    fields={selectedProviderConfig.fields}
                                    isEditMode={isEdit}
                                />
                            </>
                        )}

                        <Collapse className="[&_.ant-collapse-content]:bg-transparent" size="small">
                            <Collapse.Panel header="Example Request" key="preview" forceRender>
                                <RequestPreview form={form} />
                            </Collapse.Panel>
                        </Collapse>
                    </div>
                </Form>
            </EnhancedDrawer>
        </>
    )
}

export default AutomationDrawer
