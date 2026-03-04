import React, {useCallback, useEffect, useState} from "react"

import {Button, Form, Input, Select, Tooltip, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/webhooks/types"
import {createWebhookAtom, testWebhookAtom, updateWebhookAtom} from "@/oss/state/webhooks/atoms"
import {
    createdWebhookSecretAtom,
    editingWebhookAtom,
    isCreateWebhookModalOpenAtom,
} from "@/oss/state/webhooks/state"

import {EVENT_OPTIONS} from "./constants"
import CreatedWebhookSecretModal from "./CreatedWebhookSecretModal"

interface Props {
    onSuccess: () => void
}

const CreateWebhookDrawer: React.FC<Props> = ({onSuccess}) => {
    const [form] = Form.useForm()
    const [open, setOpen] = useAtom(isCreateWebhookModalOpenAtom)
    const [initialValues, setEditingWebhook] = useAtom(editingWebhookAtom)
    const [isTesting, setIsTesting] = useState(false)
    const setCreatedWebhookSecret = useSetAtom(createdWebhookSecretAtom)

    const createWebhook = useSetAtom(createWebhookAtom)
    const updateWebhook = useSetAtom(updateWebhookAtom)
    const testWebhook = useSetAtom(testWebhookAtom)

    const isEdit = !!initialValues

    const onCancel = useCallback(() => {
        setOpen(false)
        setEditingWebhook(undefined)
    }, [setOpen, setEditingWebhook])

    useEffect(() => {
        if (open && initialValues) {
            form.setFieldsValue({
                name: initialValues.name,
                url: initialValues.data.url,
                events: initialValues.data.event_types || [],
            })
        } else if (open) {
            // Fields are reset via component unmount (destroyOnHidden),
            // but we still need to set the default value for new creations
            form.setFieldsValue({
                events: ["environments.revisions.committed"],
            })
        }
    }, [open, initialValues, form])

    const handleTestConnection = useCallback(async () => {
        if (!initialValues?.id) return

        try {
            setIsTesting(true)
            const response = await testWebhook(initialValues.id)
            const delivery = response.delivery

            if (delivery?.status?.code === "success" || delivery?.status?.type === "success") {
                message.success(
                    `Connection successful! Status: ${delivery.data?.response?.status_code || 200}`,
                    10,
                )
            } else {
                message.error(
                    `Connection failed. ${delivery?.status?.message || "Unknown error"}`,
                    10,
                )
            }
        } catch (error) {
            console.error(error)
            message.error("Failed to test connection")
        } finally {
            setIsTesting(false)
        }
    }, [initialValues?.id, testWebhook])

    const handleOk = useCallback(async () => {
        try {
            const values = await form.validateFields()
            if (isEdit && initialValues?.id) {
                const payload: WebhookSubscriptionEditRequest = {
                    subscription: {
                        id: initialValues.id,
                        name: values.name,
                        data: {
                            url: values.url,
                            event_types: values.events,
                        },
                    },
                }
                await updateWebhook({webhookId: initialValues.id, payload})
                message.success("Webhook updated successfully")
            } else {
                const payload: WebhookSubscriptionCreateRequest = {
                    subscription: {
                        name: values.name,
                        data: {
                            url: values.url,
                            event_types: values.events,
                        },
                    },
                }
                const response = await createWebhook(payload)
                const webhookSecret =
                    response.subscription?.secret || response.subscription?.secret_id
                setCreatedWebhookSecret(webhookSecret ?? null)
                message.success("Webhook created successfully")
            }
            onSuccess()
            onCancel()
        } catch (error) {
            console.error(error)
            message.error(isEdit ? "Failed to update webhook" : "Failed to create webhook")
        }
    }, [
        form,
        isEdit,
        initialValues,
        onSuccess,
        onCancel,
        setCreatedWebhookSecret,
        createWebhook,
        updateWebhook,
    ])

    return (
        <>
            <EnhancedDrawer
                title={isEdit ? "Edit Webhook" : "Create Webhook"}
                open={open}
                onClose={onCancel}
                width={560}
                destroyOnHidden
                footer={
                    <div className="flex items-center justify-between gap-2">
                        <Button onClick={onCancel}>Cancel</Button>
                        <div className="flex items-center gap-2">
                            <Tooltip
                                title={
                                    isEdit
                                        ? "Test this webhook"
                                        : "You must save the webhook before testing it"
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
                <div className="mb-4">
                    Webhooks allow you to receive real-time notifications when events happen in
                    Agenta. Use them to trigger automated workflows or integrate with other tools.{" "}
                    <Typography.Link
                        href="https://docs.agenta.ai/self-hosting/concepts/webhooks"
                        target="_blank"
                        className="font-medium"
                    >
                        Read documentation
                    </Typography.Link>
                </div>

                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="name"
                        label="Name"
                        className="!mb-3"
                        rules={[{required: true, message: "Please enter the webhook name"}]}
                    >
                        <Input placeholder="My Webhook" />
                    </Form.Item>
                    <Form.Item
                        name="url"
                        label="Payload URL"
                        className="!mb-3"
                        rules={[
                            {required: true, message: "Please enter the URL"},
                            {type: "url", message: "Please enter a valid URL"},
                        ]}
                    >
                        <Input placeholder="https://example.com/webhook" />
                    </Form.Item>

                    <Form.Item
                        name="events"
                        label="Events"
                        className="!mb-3"
                        rules={[{required: true, message: "Please select at least one event"}]}
                    >
                        <Select
                            mode="multiple"
                            placeholder="Select events"
                            options={EVENT_OPTIONS}
                        />
                    </Form.Item>
                </Form>
            </EnhancedDrawer>
            <CreatedWebhookSecretModal />
        </>
    )
}

export default CreateWebhookDrawer
