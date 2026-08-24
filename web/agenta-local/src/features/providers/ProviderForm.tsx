import {KeyOutlined, LinkOutlined} from "@ant-design/icons"
import {Alert, Button, Form, Input, Select, Typography} from "antd"
import {useState} from "react"

import {saveProvider} from "@/lib/state/providers"

const providerOptions = [
    {value: "openai", label: "OpenAI"},
    {value: "anthropic", label: "Anthropic"},
    {value: "google", label: "Google AI"},
    {value: "openrouter", label: "OpenRouter"},
]

export const ProviderForm = ({onSaved}: {onSaved?: () => void}) => {
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async (values: {provider: string; apiKey: string; baseUrl?: string}) => {
        setSaving(true)
        setError(null)
        try {
            await saveProvider(values.provider, {
                credentials: {api_key: values.apiKey},
                connection: values.baseUrl ? {base_url: values.baseUrl} : {},
            })
            form.resetFields(["apiKey"])
            onSaved?.()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not save this provider")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="setup-card">
            <div className="setup-icon">
                <KeyOutlined />
            </div>
            <Typography.Title level={3}>Connect a model provider</Typography.Title>
            <Typography.Paragraph type="secondary">
                Your API key stays on this machine. Agenta Local never returns it to the browser
                after saving.
            </Typography.Paragraph>
            {error ? <Alert showIcon type="error" message={error} className="form-alert" /> : null}
            <Form
                form={form}
                layout="vertical"
                requiredMark="optional"
                onFinish={(values) => void submit(values)}
            >
                <Form.Item
                    label="Provider"
                    name="provider"
                    rules={[{required: true}]}
                    initialValue="openai"
                >
                    <Select size="large" options={providerOptions} />
                </Form.Item>
                <Form.Item
                    label="API key"
                    name="apiKey"
                    rules={[{required: true, message: "Enter an API key"}]}
                >
                    <Input.Password
                        size="large"
                        prefix={<KeyOutlined />}
                        autoComplete="off"
                        placeholder="Paste your provider key"
                    />
                </Form.Item>
                <Form.Item label="Custom base URL" name="baseUrl">
                    <Input
                        size="large"
                        prefix={<LinkOutlined />}
                        placeholder="Optional"
                        autoComplete="off"
                    />
                </Form.Item>
                <Button block size="large" type="primary" htmlType="submit" loading={saving}>
                    Save provider
                </Button>
            </Form>
        </div>
    )
}
