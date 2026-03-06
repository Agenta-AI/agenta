import React, {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Form, Input, message, Segmented, Select, Tooltip, Typography} from "antd"
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

import {EVENT_OPTIONS, PROVIDER_OPTIONS} from "./constants"
import {GitHubFields, WebhookFields} from "./providers"
import {RequestPreview} from "./RequestPreview"
import SecretRevealModal from "./SecretRevealModal"
import {buildSubscription} from "./utils/buildSubscription"
import {handleTestResult} from "./utils/handleTestResult"

interface Props {
    onSuccess: () => void
}

const AutomationDrawer: React.FC<Props> = ({onSuccess}) => {
    const [form] = Form.useForm()
    const [open, setOpen] = useAtom(isAutomationDrawerOpenAtom)
    const [initialValues, setEditingWebhook] = useAtom(editingAutomationAtom)
    const [isTesting, setIsTesting] = useState(false)
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
        if (open && initialValues) {
            // Determine provider via heuristic since no meta field is stored.
            const isGitHub = initialValues.data.url.includes("api.github.com")
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
                        github_branch = initialValues.data.payload_fields.ref
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
        } else if (open) {
            setSelectedProvider("webhook")
            form.setFieldsValue({
                provider: "webhook",
                events: ["environments.revisions.committed"],
                auth_mode: "signature",
                github_sub_type: "repository_dispatch",
            })
        }
    }, [open, initialValues, form, setSelectedProvider])

    const handleTestConnection = useCallback(async () => {
        if (!initialValues?.id) return

        try {
            setIsTesting(true)
            const response = await testAutomation(initialValues.id)
            handleTestResult(response)
        } catch (error) {
            console.error(error)
            message.error("Failed to test connection")
        } finally {
            setIsTesting(false)
        }
    }, [initialValues?.id, testAutomation])

    const handleOk = useCallback(async () => {
        try {
            const rawValues = await form.validateFields()

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
                    webhookId: initialValues.id,
                    payload: payload as WebhookSubscriptionEditRequest,
                })
                message.success("Automation updated successfully")
            } else {
                const response = await createAutomation(payload as WebhookSubscriptionCreateRequest)
                const webhookSecret =
                    response.subscription?.secret || response.subscription?.secret_id

                if (selectedProvider === "webhook" && rawValues.auth_mode === "signature") {
                    setCreatedWebhookSecret(webhookSecret ?? null)
                }

                message.success("Automation created successfully")
            }
            onSuccess()
            onCancel()
        } catch (error) {
            if ((error as {errorFields?: unknown}).errorFields) return
            console.error(error)
            message.error(isEdit ? "Failed to update automation" : "Failed to create automation")
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

    const segmentedOptions = useMemo(
        () =>
            PROVIDER_OPTIONS.map((opt) => ({
                label: (
                    <div className="p-2">
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-[var(--color-text-tertiary)]">
                            {opt.description}
                        </div>
                    </div>
                ),
                value: opt.value,
            })),
        [],
    )

    return (
        <>
            <EnhancedDrawer
                title={isEdit ? "Edit Automation" : "Create Automation"}
                open={open}
                onClose={onCancel}
                width={800}
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
                                    Test Connection
                                </Button>
                            </Tooltip>
                            <Button type="primary" onClick={handleOk}>
                                {isEdit ? "Update" : "Create"}
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
                    <div className="flex gap-6">
                        <div className="flex-1">
                            <Form.Item name="provider" initialValue="webhook" className="!mb-6">
                                <Segmented block disabled={isEdit} options={segmentedOptions} />
                            </Form.Item>

                            <Form.Item
                                name="name"
                                label="Name"
                                rules={[{required: true, message: "Please enter a name"}]}
                            >
                                <Input placeholder="My Automation" />
                            </Form.Item>

                            <Form.Item
                                name="events"
                                label="Events"
                                rules={[
                                    {required: true, message: "Please select at least one event"},
                                ]}
                            >
                                <Select
                                    mode="multiple"
                                    placeholder="Select events"
                                    options={EVENT_OPTIONS}
                                />
                            </Form.Item>

                            <div className="mt-8 mb-4 border-b border-[var(--color-border)]">
                                <Typography.Title level={5}>
                                    {selectedProvider === "github"
                                        ? "GitHub Configuration"
                                        : "Webhook Configuration"}
                                </Typography.Title>
                            </div>

                            {selectedProvider === "github" ? (
                                <GitHubFields isEditMode={isEdit} />
                            ) : (
                                <WebhookFields isEditMode={isEdit} />
                            )}
                        </div>

                        {/* <div className="w-[40%] border-l border-[var(--color-border)] pl-6">
                            <Typography.Title level={5} className="!mb-4">
                                Request Preview
                            </Typography.Title>
                            <Typography.Text type="secondary" className="mb-4 block text-[13px]">
                                This is a simulation of the HTTP request that Agenta will send when
                                the event occurs.
                            </Typography.Text>

                            <RequestPreview form={form} />
                        </div> */}
                    </div>
                </Form>
            </EnhancedDrawer>
            <SecretRevealModal />
        </>
    )
}

export default AutomationDrawer
