/**
 * Webhook configuration modal
 */

import {FC, useState} from "react"
import {Modal, Form, Input, Switch, Select, Button, Space, Typography, message, Tabs} from "antd"
import {PlusOutlined, DeleteOutlined, InfoCircleOutlined} from "@ant-design/icons"

import {webhookService} from "@/oss/services/webhooks/api"
import type {
    Webhook,
    CreateWebhookPayload,
    UpdateWebhookPayload,
    EnvironmentVariable,
    HttpHeader,
    WebhookType,
} from "@/oss/services/webhooks/types"

const {TextArea} = Input
const {Text} = Typography

interface WebhookConfigModalProps {
    visible: boolean
    onClose: () => void
    appId: string
    webhook?: Webhook | null
    mode: "create" | "edit"
}

const WebhookConfigModal: FC<WebhookConfigModalProps> = ({
    visible,
    onClose,
    appId,
    webhook,
    mode,
}) => {
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const webhookType = Form.useWatch("webhook_type", form)

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields()
            setLoading(true)

            // Convert environment_variables form data to the expected format
            const payload = {
                ...values,
                environment_variables: values.environment_variables?.map((env: any) => ({
                    key: env.key,
                    value: env.value,
                    is_secret: env.is_secret || false,
                })) || [],
                webhook_headers: values.webhook_headers?.map((h: any) => ({
                    key: h.key,
                    value: h.value,
                    is_secret: h.is_secret || false,
                })) || [],
            }

            if (mode === "create") {
                await webhookService.createWebhook({
                    ...payload,
                    app_id: appId,
                } as CreateWebhookPayload)
            } else {
                await webhookService.updateWebhook(webhook!.id, payload as UpdateWebhookPayload)
            }

            onClose()
        } catch (error: any) {
            message.error(error.response?.data?.detail || "Failed to save webhook")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal
            title={mode === "create" ? "Create Webhook" : "Edit Webhook"}
            open={visible}
            onCancel={onClose}
            width={800}
            destroyOnClose
            footer={
                <Space>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="primary" onClick={handleSubmit} loading={loading}>
                        {mode === "create" ? "Create" : "Save"}
                    </Button>
                </Space>
            }
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={webhook || {
                    webhook_type: "python_script" as WebhookType,
                    is_enabled: true,
                    script_timeout: 300,
                    docker_image: "python:3.11-slim",
                    webhook_method: "POST",
                    retry_on_failure: false,
                    max_retries: 3,
                    retry_delay_seconds: 60,
                    trigger_on_environments: [],
                    environment_variables: [],
                    webhook_headers: [],
                }}
            >
                <Form.Item
                    label="Webhook Name"
                    name="name"
                    rules={[{required: true, message: "Please enter a name"}]}
                >
                    <Input placeholder="e.g., Slack Notification" />
                </Form.Item>

                <Form.Item
                    label="Description"
                    name="description"
                >
                    <Input.TextArea rows={2} placeholder="Optional description" />
                </Form.Item>

                <Form.Item
                    label="Webhook Type"
                    name="webhook_type"
                    rules={[{required: true}]}
                >
                    <Select
                        options={[
                            {label: "HTTP Webhook", value: "http_webhook"},
                            {label: "Python Script", value: "python_script"},
                        ]}
                    />
                </Form.Item>

                {webhookType === "http_webhook" ? (
                    <>
                        <Form.Item
                            label="Webhook URL"
                            name="webhook_url"
                            rules={[{required: true, type: "url", message: "Please enter a valid URL"}]}
                            extra="The HTTP endpoint to call after deployment"
                        >
                            <Input placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL" />
                        </Form.Item>

                        <Form.Item
                            label="HTTP Method"
                            name="webhook_method"
                        >
                            <Select
                                options={[
                                    {label: "POST", value: "POST"},
                                    {label: "GET", value: "GET"},
                                    {label: "PUT", value: "PUT"},
                                    {label: "PATCH", value: "PATCH"},
                                    {label: "DELETE", value: "DELETE"},
                                ]}
                            />
                        </Form.Item>

                        <Form.Item
                            label="HTTP Headers"
                            name="webhook_headers"
                        >
                            <HttpHeadersInput />
                        </Form.Item>

                        <Form.Item
                            label="Request Body Template"
                            name="webhook_body_template"
                            extra={
                                <Space direction="vertical" style={{width: "100%"}}>
                                    <Text type="secondary">
                                        JSON template with variables: {"{{app_id}}"}, {"{{environment}}"},
                                        {"{{deployment_id}}"}, {"{{variant_id}}"}, {"{{variant_revision_id}}"},
                                        {"{{project_id}}"}
                                    </Text>
                                    <Text type="secondary" code>
                                        Example: {`{"text": "Deployed {{environment}} - {{deployment_id}}"}`}
                                    </Text>
                                </Space>
                            }
                        >
                            <TextArea
                                rows={8}
                                placeholder='{"text": "Deployed to {{environment}}"}'
                                code
                            />
                        </Form.Item>
                    </>
                ) : (
                    <>
                        <Form.Item
                            label={<Space>Python Script <InfoCircleOutlined /></Space>}
                            name="script_content"
                            rules={[{required: true, message: "Please enter the script"}]}
                            extra={
                                <Space direction="vertical" style={{width: "100%"}}>
                                    <Text type="secondary">
                                        Available environment variables: AGENTA_DEPLOYMENT_APP_ID,
                                        AGENTA_DEPLOYMENT_ENVIRONMENT, AGENTA_DEPLOYMENT_DEPLOYMENT_ID,
                                        AGENTA_DEPLOYMENT_VARIANT_ID, AGENTA_DEPLOYMENT_VARIANT_REVISION_ID,
                                        AGENTA_DEPLOYMENT_PROJECT_ID
                                    </Text>
                                    <Text type="secondary">
                                        Plus any custom environment variables you define below.
                                    </Text>
                                </Space>
                            }
                        >
                            <TextArea
                                rows={15}
                                placeholder="# Your Python code here
import os
import requests

# Access deployment info
env_name = os.environ.get('AGENTA_DEPLOYMENT_ENVIRONMENT')
deployment_id = os.environ.get('AGENTA_DEPLOYMENT_DEPLOYMENT_ID')

# Your custom logic
webhook_url = os.environ.get('SLACK_WEBHOOK_URL')
requests.post(webhook_url, json={
    'text': f'Deployed to {env_name}'
})"
                                code
                            />
                        </Form.Item>

                        <Form.Item
                            label="Docker Image"
                            name="docker_image"
                            extra="The Docker image to use for script execution. Make sure it has Python installed."
                        >
                            <Input placeholder="python:3.11-slim" />
                        </Form.Item>

                        <Form.Item
                            label="Timeout (seconds)"
                            name="script_timeout"
                            rules={[{type: "number", min: 10, max: 3600, message: "Must be between 10 and 3600"}]}
                        >
                            <Input type="number" min={10} max={3600} />
                        </Form.Item>
                    </>
                )}

                <Form.Item
                    label={<Space>Trigger Environments <InfoCircleOutlined /></Space>}
                    name="trigger_on_environments"
                    extra="Leave empty to trigger on all environments, or select specific environments"
                >
                    <Select
                        mode="tags"
                        placeholder="Select environments (empty = all)"
                        style={{width: "100%"}}
                        options={[
                            {label: "production", value: "production"},
                            {label: "staging", value: "staging"},
                            {label: "development", value: "development"},
                        ]}
                    />
                </Form.Item>

                {webhookType === "python_script" && (
                    <Form.Item
                        label="Environment Variables"
                        name="environment_variables"
                    >
                        <EnvironmentVariablesInput />
                    </Form.Item>
                )}

                <Form.Item
                    label="Retry on Failure"
                    name="retry_on_failure"
                    valuePropName="checked"
                >
                    <Switch />
                </Form.Item>

                {Form.useWatch("retry_on_failure", form) && (
                    <>
                        <Form.Item
                            label="Max Retries"
                            name="max_retries"
                            rules={[{type: "number", min: 0, max: 10, message: "Must be between 0 and 10"}]}
                        >
                            <Input type="number" min={0} max={10} />
                        </Form.Item>

                        <Form.Item
                            label="Retry Delay (seconds)"
                            name="retry_delay_seconds"
                            rules={[{type: "number", min: 0, max: 3600, message: "Must be between 0 and 3600"}]}
                        >
                            <Input type="number" min={0} max={3600} />
                        </Form.Item>
                    </>
                )}

                <Form.Item
                    label="Enabled"
                    name="is_enabled"
                    valuePropName="checked"
                >
                    <Switch />
                </Form.Item>
            </Form>
        </Modal>
    )
}

// HTTP headers input component
const HttpHeadersInput: FC = () => {
    return (
        <Form.List name="webhook_headers">
            {(fields, {add, remove}) => (
                <>
                    {fields.map(({key, name, ...restField}) => (
                        <Space key={key} style={{display: "flex", marginBottom: 8}} align="baseline">
                            <Form.Item
                                {...restField}
                                name={[name, "key"]}
                                rules={[{required: true, message: "Required"}]}
                                style={{marginBottom: 0}}
                            >
                                <Input placeholder="Header name (e.g., Authorization)" style={{width: 250}} />
                            </Form.Item>
                            <Form.Item
                                {...restField}
                                name={[name, "value"]}
                                rules={[{required: true, message: "Required"}]}
                                style={{marginBottom: 0}}
                            >
                                <Input placeholder="Header value" style={{width: 300}} />
                            </Form.Item>
                            <Form.Item
                                {...restField}
                                name={[name, "is_secret"]}
                                valuePropName="checked"
                                style={{marginBottom: 0}}
                            >
                                <Switch checkedChildren="Secret" unCheckedChildren="Plain" />
                            </Form.Item>
                            <DeleteOutlined onClick={() => remove(name)} style={{cursor: "pointer"}} />
                        </Space>
                    ))}
                    <Form.Item style={{marginBottom: 0}}>
                        <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                            Add HTTP Header
                        </Button>
                    </Form.Item>
                </>
            )}
        </Form.List>
    )
}

// Environment variables input component
const EnvironmentVariablesInput: FC = () => {
    return (
        <Form.List name="environment_variables">
            {(fields, {add, remove}) => (
                <>
                    {fields.map(({key, name, ...restField}) => (
                        <Space key={key} style={{display: "flex", marginBottom: 8}} align="baseline">
                            <Form.Item
                                {...restField}
                                name={[name, "key"]}
                                rules={[{required: true, message: "Required"}]}
                                style={{marginBottom: 0}}
                            >
                                <Input placeholder="Key" style={{width: 200}} />
                            </Form.Item>
                            <Form.Item
                                {...restField}
                                name={[name, "value"]}
                                rules={[{required: true, message: "Required"}]}
                                style={{marginBottom: 0}}
                            >
                                <Input.Password placeholder="Value" style={{width: 300}} />
                            </Form.Item>
                            <Form.Item
                                {...restField}
                                name={[name, "is_secret"]}
                                valuePropName="checked"
                                style={{marginBottom: 0}}
                            >
                                <Switch checkedChildren="Secret" unCheckedChildren="Plain" />
                            </Form.Item>
                            <DeleteOutlined onClick={() => remove(name)} style={{cursor: "pointer"}} />
                        </Space>
                    ))}
                    <Form.Item style={{marginBottom: 0}}>
                        <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                            Add Environment Variable
                        </Button>
                    </Form.Item>
                </>
            )}
        </Form.List>
    )
}

export default WebhookConfigModal
