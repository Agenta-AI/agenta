import React, {useCallback, useEffect, useMemo} from "react"

import {EnhancedModal, ModalContent} from "@agenta/ui"
import {Button, Form, Input, Select, Switch, Tooltip, message} from "antd"

import {createWebhook, testWebhook, updateWebhook} from "@/oss/services/webhooks/api"
import {
    WebhookSubscription,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/webhooks/types"

import {EVENT_OPTIONS} from "./constants"

interface Props {
    open: boolean
    onCancel: () => void
    onSuccess: () => void
    initialValues?: WebhookSubscription
}

const CreateWebhookModal: React.FC<Props> = ({open, onCancel, onSuccess, initialValues}) => {
    const [form] = Form.useForm()
    const isEdit = !!initialValues
    const [isTesting, setIsTesting] = React.useState(false)

    useEffect(() => {
        if (open && initialValues) {
            form.setFieldsValue({
                name: initialValues.name,
                url: initialValues.data.url,
                events: initialValues.data.event_types || [],
                is_valid: initialValues.flags?.is_valid ?? true,
            })
        } else if (open) {
            form.resetFields()
            form.setFieldsValue({
                is_valid: true,
                events: ["environments.revisions.committed"],
            })
        }
        setIsTesting(false)
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
    }, [initialValues?.id])

    const handleOk = useCallback(async () => {
        try {
            const values = await form.validateFields()
            console.log("Webhook outside", values)
            if (isEdit && initialValues?.id) {
                console.log("Webhook edit")
                const payload: WebhookSubscriptionEditRequest = {
                    subscription: {
                        id: initialValues.id,
                        name: values.name,
                        flags: {is_valid: values.is_valid},
                        data: {
                            url: values.url,
                            event_types: values.events,
                        },
                    },
                }
                await updateWebhook(initialValues.id, payload)
                message.success("Webhook updated successfully")
            } else {
                console.log("Webhook create")
                const payload: WebhookSubscriptionCreateRequest = {
                    subscription: {
                        name: values.name,
                        flags: {is_valid: values.is_valid},
                        data: {
                            url: values.url,
                            event_types: values.events,
                        },
                    },
                }
                console.log("Webhook create payload", payload)
                await createWebhook(payload)
                message.success("Webhook created successfully")
            }
            onSuccess()
        } catch (error) {
            console.error(error)
        }
    }, [form, isEdit, initialValues, onSuccess])

    const footer = useMemo(
        () => (
            <div className="flex items-center justify-end gap-2 pt-2">
                <Button onClick={onCancel}>Cancel</Button>
                <Tooltip
                    title={
                        isEdit ? "Test this webhook" : "You must save the webhook before testing it"
                    }
                >
                    <Button loading={isTesting} onClick={handleTestConnection} disabled={!isEdit}>
                        Test Connection
                    </Button>
                </Tooltip>
                <Button type="primary" onClick={handleOk}>
                    {isEdit ? "Update" : "Create"}
                </Button>
            </div>
        ),
        [isEdit, isTesting, onCancel, handleTestConnection, handleOk],
    )

    return (
        <EnhancedModal
            title={isEdit ? "Edit Webhook" : "Create Webhook"}
            open={open}
            onCancel={onCancel}
            footer={footer}
        >
            <ModalContent className="mt-5">
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

                    <Form.Item
                        name="is_valid"
                        label="Active"
                        valuePropName="checked"
                        className="!mb-0"
                    >
                        <Switch />
                    </Form.Item>
                </Form>
            </ModalContent>
        </EnhancedModal>
    )
}

export default CreateWebhookModal
