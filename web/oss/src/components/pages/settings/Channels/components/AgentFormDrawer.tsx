import {useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Button, Drawer, Form, Input, Select, Switch, message} from "antd"

import {
    fetchChannelAgent,
    useChannelAgentActions,
    useChannelConnectionsQuery,
    useChannelPolicyResolve,
} from "@/oss/state/channels"

import {PolicyEditor} from "./PolicyEditor"

interface AgentFormValues {
    slug: string
    name?: string
    connection_id: string
    workflow_id: string
    is_active: boolean
}

export interface AgentFormDrawerProps {
    open: boolean
    onClose: () => void
    /** When set, edits this agent (full-PUT). Absent = create. */
    agentId?: string | null
    onSaved?: (agent: AgentaApi.ChannelAgent) => void
}

const emptyPolicy: AgentaApi.ChannelPolicy = {}

/**
 * Create/edit form for a channel agent. Edits are full-PUT: the current
 * `data`/`flags` document is fetched fresh and only the fields this form
 * owns are overridden — never a partial policy patch.
 */
export default function AgentFormDrawer({open, onClose, agentId, onSaved}: AgentFormDrawerProps) {
    const [form] = Form.useForm<AgentFormValues>()
    const {connections} = useChannelConnectionsQuery()
    const {create, edit} = useChannelAgentActions()
    const [policy, setPolicy] = useState<AgentaApi.ChannelPolicy>(emptyPolicy)
    const [current, setCurrent] = useState<AgentaApi.ChannelAgent | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const {policy: effectivePolicy} = useChannelPolicyResolve(
        agentId ?? null,
        // The explain panel here needs a space to resolve against; without one
        // (creating a new agent, or no space picked yet) only capability-level
        // denials are meaningful, so we skip resolution and rely on the editor's
        // own "no opinion" defaults.
        null,
    )

    useEffect(() => {
        if (!open) return
        if (!agentId) {
            form.resetFields()
            setPolicy({})
            setCurrent(null)
            return
        }
        setIsLoading(true)
        fetchChannelAgent(agentId)
            .then((res) => {
                const agent = res.agent ?? null
                setCurrent(agent)
                if (agent) {
                    form.setFieldsValue({
                        slug: agent.slug ?? "",
                        name: agent.name ?? undefined,
                        connection_id: agent.connection_id,
                        workflow_id: Object.values(agent.data.references ?? {})[0]?.id ?? "",
                        is_active: agent.flags?.is_active ?? true,
                    })
                    setPolicy(agent.data.policy ?? {})
                }
            })
            .finally(() => setIsLoading(false))
    }, [open, agentId, form])

    const handleSubmit = async () => {
        const values = await form.validateFields()
        setIsSaving(true)
        try {
            const data: AgentaApi.ChannelAgentData = {
                references: {main: {id: values.workflow_id}},
                policy,
            }
            const flags: AgentaApi.ChannelAgentFlags = {
                is_active: values.is_active,
                is_default: current?.flags?.is_default ?? false,
            }

            if (agentId && current) {
                const result = await edit(agentId, {
                    id: agentId,
                    name: values.name,
                    data,
                    flags,
                })
                message.success("Agent updated")
                if (result.agent) onSaved?.(result.agent)
            } else {
                const result = await create({
                    slug: values.slug,
                    name: values.name,
                    connection_id: values.connection_id,
                    data,
                    flags,
                })
                message.success("Agent created")
                if (result.agent) onSaved?.(result.agent)
            }
            onClose()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save agent")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Drawer
            title={agentId ? "Edit agent" : "New agent"}
            open={open}
            onClose={onClose}
            width={480}
            loading={isLoading}
            destroyOnClose
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="primary" onClick={handleSubmit} loading={isSaving}>
                        Save
                    </Button>
                </div>
            }
        >
            <Form form={form} layout="vertical" initialValues={{is_active: true}}>
                <Form.Item
                    name="slug"
                    label="Slug"
                    rules={[{required: true, message: "Slug is required"}]}
                    extra="What someone types after the sigil (e.g. ~triage)"
                >
                    <Input disabled={!!agentId} placeholder="triage" />
                </Form.Item>
                <Form.Item name="name" label="Name">
                    <Input placeholder="Triage agent" />
                </Form.Item>
                <Form.Item
                    name="connection_id"
                    label="Connection"
                    rules={[{required: true, message: "Connection is required"}]}
                >
                    <Select
                        disabled={!!agentId}
                        placeholder="Select a connection"
                        options={connections.map((c) => ({
                            label: c.name || c.slug || c.external_key,
                            value: c.id,
                        }))}
                    />
                </Form.Item>
                <Form.Item
                    name="workflow_id"
                    label="Bound workflow"
                    rules={[{required: true, message: "A workflow reference is required"}]}
                    extra="The workflow/variant/revision this agent runs"
                >
                    <Input placeholder="workflow id" />
                </Form.Item>
                <Form.Item name="is_active" label="Active" valuePropName="checked">
                    <Switch />
                </Form.Item>
            </Form>
            <div className="mt-4 flex flex-col gap-3">
                <div className="text-xs font-medium text-colorTextSecondary">Policy</div>
                <PolicyEditor
                    value={policy}
                    onChange={setPolicy}
                    decidedBy={effectivePolicy?.decided_by}
                    editingLevel="agent"
                />
            </div>
        </Drawer>
    )
}
