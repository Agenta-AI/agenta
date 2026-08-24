import {DeleteOutlined, SaveOutlined} from "@ant-design/icons"
import {Alert, Button, Form, Input, Popconfirm, Select, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useEffect, useState} from "react"

import {
    commitAgentRevision,
    createAgent,
    deleteAgent,
    selectedAgentQueryAtom,
} from "@/lib/state/agents"
import {providersQueryAtom} from "@/lib/state/providers"

import {AgentRevisionBadge} from "./AgentRevisionBadge"

const models: Record<string, {value: string; label: string}[]> = {
    openai: [
        {value: "gpt-5-mini", label: "GPT-5 mini"},
        {value: "gpt-4o-mini", label: "GPT-4o mini"},
    ],
    anthropic: [
        {value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5"},
        {value: "claude-haiku-4-5", label: "Claude Haiku 4.5"},
    ],
    google: [{value: "gemini-2.5-flash", label: "Gemini 2.5 Flash"}],
    openrouter: [{value: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini"}],
}

interface EditorValues {
    name: string
    instructions: string
    provider: string
    model: string
}

export const AgentEditor = ({
    agentId,
    onCreated,
    onDeleted,
}: {
    agentId?: string
    onCreated: (id: string) => void
    onDeleted: () => void
}) => {
    const [form] = Form.useForm<EditorValues>()
    const providers = useAtomValue(providersQueryAtom)
    const agent = useAtomValue(selectedAgentQueryAtom)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const provider = Form.useWatch("provider", form)
    const current = agentId ? agent.data : undefined

    useEffect(() => {
        if (current) {
            form.setFieldsValue({
                name: current.name,
                instructions: current.current_revision.instructions,
                provider: current.current_revision.model.provider,
                model: current.current_revision.model.name,
            })
        } else if (!agentId) {
            const firstProvider =
                providers.data?.find((item) => item.configured)?.provider ?? "openai"
            form.resetFields()
            form.setFieldsValue({provider: firstProvider, model: models[firstProvider]?.[0]?.value})
        }
    }, [agentId, current, form, providers.data])

    const save = async (values: EditorValues) => {
        setSaving(true)
        setError(null)
        try {
            const executable = {
                instructions: values.instructions.trim(),
                model: {provider: values.provider, name: values.model, parameters: {}},
                execution: {},
            }
            if (current) {
                const original = current.current_revision
                const changed =
                    executable.instructions !== original.instructions ||
                    executable.model.provider !== original.model.provider ||
                    executable.model.name !== original.model.name
                if (changed) await commitAgentRevision(current.id, executable)
            } else {
                const created = await createAgent({...executable, name: values.name.trim()})
                onCreated(created.id)
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Agent could not be saved")
        } finally {
            setSaving(false)
        }
    }

    if (agentId && agent.isPending)
        return <div className="editor-skeleton skeleton-block" aria-label="Loading agent" />
    if (agentId && agent.isError)
        return <Alert showIcon type="error" message="This agent could not be loaded" />

    const providerOptions = (providers.data ?? [])
        .filter((item) => item.configured)
        .map((item) => ({value: item.provider, label: item.provider}))

    return (
        <div className="editor-panel">
            <header className="editor-header">
                <div>
                    <Typography.Text className="eyebrow">
                        {current ? "AGENT CONFIGURATION" : "NEW AGENT"}
                    </Typography.Text>
                    <Typography.Title level={2}>
                        {current?.name ?? "Create an agent"}
                    </Typography.Title>
                    {current ? (
                        <AgentRevisionBadge version={current.current_revision.version} />
                    ) : null}
                </div>
                {current ? (
                    <Popconfirm
                        title="Delete this agent?"
                        onConfirm={async () => {
                            await deleteAgent(current.id)
                            onDeleted()
                        }}
                    >
                        <Button danger type="text" icon={<DeleteOutlined />}>
                            Delete
                        </Button>
                    </Popconfirm>
                ) : null}
            </header>
            {error ? <Alert showIcon type="error" message={error} className="form-alert" /> : null}
            <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                onFinish={(values) => void save(values)}
            >
                <Form.Item
                    label="Name"
                    name="name"
                    rules={[{required: true, whitespace: true}]}
                    extra={current ? "Names are immutable in the current local API." : undefined}
                >
                    <Input
                        size="large"
                        disabled={Boolean(current)}
                        placeholder="Research assistant"
                    />
                </Form.Item>
                <div className="form-grid">
                    <Form.Item label="Provider" name="provider" rules={[{required: true}]}>
                        <Select
                            size="large"
                            options={providerOptions}
                            onChange={(value) =>
                                form.setFieldValue("model", models[value]?.[0]?.value)
                            }
                        />
                    </Form.Item>
                    <Form.Item label="Model" name="model" rules={[{required: true}]}>
                        <Select
                            size="large"
                            options={models[provider] ?? []}
                            showSearch
                            optionFilterProp="label"
                        />
                    </Form.Item>
                </div>
                <Form.Item
                    label="Instructions"
                    name="instructions"
                    rules={[
                        {required: true, whitespace: true, message: "Tell the agent how to behave"},
                    ]}
                    extra="Be specific about the role, desired output, and boundaries."
                >
                    <Input.TextArea
                        className="instructions-input"
                        autoSize={{minRows: 10, maxRows: 20}}
                        placeholder="You are a concise research assistant..."
                    />
                </Form.Item>
                <div className="editor-actions">
                    <Typography.Text type="secondary">
                        {current
                            ? "Executable changes create a new immutable revision."
                            : "This creates revision v1."}
                    </Typography.Text>
                    <Button
                        type="primary"
                        size="large"
                        htmlType="submit"
                        loading={saving}
                        icon={<SaveOutlined />}
                    >
                        {current ? "Commit revision" : "Create agent"}
                    </Button>
                </div>
            </Form>
        </div>
    )
}
