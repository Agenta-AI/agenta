import React, {useEffect} from "react"

import {Button, Form, Input, Modal, Select, Switch, message} from "antd"

import {createWebhook, testWebhook, updateWebhook} from "@/oss/services/webhooks/api"
import {CreateWebhookSubscription, WebhookSubscription} from "@/oss/services/webhooks/types"
import {useOrgData} from "@/oss/state/org"

interface Props {
    open: boolean
    onCancel: () => void
    onSuccess: () => void
    initialValues?: WebhookSubscription
}

const CreateWebhookModal: React.FC<Props> = ({open, onCancel, onSuccess, initialValues}) => {
    const [form] = Form.useForm()
    const {selectedOrg} = useOrgData()
    const isEdit = !!initialValues
    const [isTesting, setIsTesting] = React.useState(false)

    useEffect(() => {
        if (open && initialValues) {
            form.setFieldsValue({
                name: initialValues.name,
                url: initialValues.url,
                events: initialValues.events,
                is_active: initialValues.is_active,
            })
        } else if (open) {
            form.resetFields()
            form.setFieldsValue({
                is_active: true,
                events: ["config.deployed"], // Default to the only available event for now
            })
        }
        setIsTesting(false)
    }, [open, initialValues, form])

    const handleTestConnection = async () => {
        try {
            // Validate only URL and Events for testing
            await form.validateFields(["url", "events"])
            const url = form.getFieldValue("url")
            const events = form.getFieldValue("events")
            const eventType = events[0] || "config.deployed"

            const workspaceId = selectedOrg?.default_workspace?.id
            if (!workspaceId) return

            setIsTesting(true)
            const response = await testWebhook(workspaceId, url, eventType)

            if (response.success) {
                message.success(
                    `Connection successful! Status: ${response.status_code}, Duration: ${response.duration_ms}ms`,
                    10, // Longer duration
                )
                // Show signature details in console for verification
                console.group("🔐 Webhook Test - Signature Verification")
                console.log("Test Secret:", response.test_secret)
                console.log("Signature Format:", response.signature_format)
                if (response.signing_payload) {
                    console.log("Signing Payload:", response.signing_payload)
                }
                console.log(
                    "ℹ️ Use the test_secret above to verify the X-Agenta-Signature header in your webhook endpoint",
                )
                console.groupEnd()
            } else {
                message.error(
                    `Connection failed. Status: ${response.status_code || "N/A"}. ${response.response_body || ""}`,
                    10,
                )
                // Still show signature details even on failure (for debugging)
                if (response.test_secret) {
                    console.group("🔐 Webhook Test - Signature Verification")
                    console.log("Test Secret:", response.test_secret)
                    console.log("Signature Format:", response.signature_format)
                    console.log("ℹ️ Even though the test failed, you can use this secret to verify signatures")
                    console.groupEnd()
                }
            }
        } catch (error) {
            console.error(error)
            // If validation fails, it handles itself
        } finally {
            setIsTesting(false)
        }
    }

    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            const workspaceId = selectedOrg?.default_workspace?.id
            if (!workspaceId) {
                message.error("Workspace not found")
                return
            }

            if (isEdit && initialValues) {
                await updateWebhook(workspaceId, initialValues.id, values)
                message.success("Webhook updated successfully")
            } else {
                await createWebhook(workspaceId, values as CreateWebhookSubscription)
                message.success("Webhook created successfully")
            }
            onSuccess()
        } catch (error) {
            console.error(error)
            message.error("Failed to save webhook")
        }
    }

    return (
        <Modal
            title={isEdit ? "Edit Webhook" : "Create Webhook"}
            open={open}
            onCancel={onCancel}
            onOk={handleOk}
            okText={isEdit ? "Update" : "Create"}
            footer={[
                <Button key="cancel" onClick={onCancel}>
                    Cancel
                </Button>,
                <Button
                    key="test"
                    loading={isTesting}
                    onClick={handleTestConnection}
                    style={{marginRight: 8}}
                >
                    Test Connection
                </Button>,
                <Button key="submit" type="primary" onClick={handleOk}>
                    {isEdit ? "Update" : "Create"}
                </Button>,
            ]}
        >
            <Form form={form} layout="vertical">
                <Form.Item
                    name="name"
                    label="Name"
                    rules={[{required: true, message: "Please enter the webhook name"}]}
                >
                    <Input placeholder="My Webhook" />
                </Form.Item>
                <Form.Item
                    name="url"
                    label="Payload URL"
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
                    rules={[{required: true, message: "Please select at least one event"}]}
                >
                    <Select
                        mode="multiple"
                        placeholder="Select events"
                        options={[{label: "Config Deployed", value: "config.deployed"}]}
                    />
                </Form.Item>

                <Form.Item name="is_active" label="Active" valuePropName="checked">
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default CreateWebhookModal
