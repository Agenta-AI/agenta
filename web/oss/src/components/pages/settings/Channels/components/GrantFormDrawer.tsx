import {useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Button, Drawer, Form, Select, message} from "antd"

import {
    useChannelAgentsQuery,
    useChannelGrantActions,
    useChannelPolicyResolve,
    useChannelSpacesQuery,
} from "@/oss/state/channels"

import {PolicyEditor} from "./PolicyEditor"

interface GrantFormValues {
    agent_id: string
    space_id: string
    effect: AgentaApi.ChannelGrantEffect
}

const EFFECT_OPTIONS: {label: string; value: AgentaApi.ChannelGrantEffect}[] = [
    {label: "Allow", value: "allow"},
    {label: "Deny", value: "deny"},
]

export interface GrantFormDrawerProps {
    open: boolean
    onClose: () => void
    /** Existing grant to edit (full-PUT). Absent = create. */
    grant?: AgentaApi.ChannelGrant | null
    /** Pre-fill when reached from the agent detail screen. */
    initialAgentId?: string
    /** Pre-fill when reached from the space detail screen. */
    initialSpaceId?: string
    onSaved?: () => void
}

const emptyPolicy: AgentaApi.ChannelPolicy = {}

/**
 * A single space-level grant, create/edit — reached from the space detail
 * screen with the space fixed and an agent to pick. Kind-level grants (the
 * DM/group-chat questions) and the channel picker live in
 * `GrantKindSection`/`GrantChannelsSection` instead, never here.
 *
 * No raw `is_default` toggle here — default-setting is the dedicated
 * `set_channel_grant_default` action on the roster/detail screens, never a
 * field on this form's PUT body.
 */
export default function GrantFormDrawer({
    open,
    onClose,
    grant,
    initialAgentId,
    initialSpaceId,
    onSaved,
}: GrantFormDrawerProps) {
    const [form] = Form.useForm<GrantFormValues>()
    const {agents} = useChannelAgentsQuery()
    const {spaces} = useChannelSpacesQuery()
    const {create, edit} = useChannelGrantActions()
    const [policy, setPolicy] = useState<AgentaApi.ChannelPolicy>(emptyPolicy)
    const [isSaving, setIsSaving] = useState(false)
    const agentId = Form.useWatch("agent_id", form) ?? grant?.agent_id ?? initialAgentId
    const spaceId = Form.useWatch("space_id", form) ?? grant?.space_id ?? initialSpaceId
    const {policy: effectivePolicy, refresh} = useChannelPolicyResolve(agentId, spaceId)

    useEffect(() => {
        if (!open) return
        form.setFieldsValue({
            agent_id: grant?.agent_id ?? initialAgentId ?? undefined,
            space_id: grant?.space_id ?? initialSpaceId ?? undefined,
            effect: grant?.effect ?? "allow",
        })
        setPolicy(grant?.data.policy ?? {})
    }, [open, grant, initialAgentId, initialSpaceId, form])

    const handleSubmit = async () => {
        const values = await form.validateFields()
        setIsSaving(true)
        try {
            const data: AgentaApi.ChannelGrantData = {policy}

            if (grant?.id) {
                await edit(grant.id, {id: grant.id, data, flags: grant.flags ?? {}})
                message.success("Grant updated")
            } else {
                await create({
                    agent_id: values.agent_id,
                    space_id: values.space_id,
                    effect: values.effect,
                    data,
                })
                message.success("Grant created")
            }
            await refresh()
            onSaved?.()
            onClose()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save grant")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Drawer
            title={grant ? "Edit grant" : "New grant"}
            open={open}
            onClose={onClose}
            width={480}
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
            <Form form={form} layout="vertical">
                <Form.Item
                    name="agent_id"
                    label="Agent"
                    rules={[{required: true, message: "Agent is required"}]}
                >
                    <Select
                        disabled={!!grant || !!initialAgentId}
                        placeholder="Select an agent"
                        options={agents.map((a) => ({label: a.name || a.slug, value: a.id}))}
                    />
                </Form.Item>
                <Form.Item
                    name="space_id"
                    label="Space"
                    rules={[{required: true, message: "Space is required"}]}
                >
                    <Select
                        disabled={!!grant || !!initialSpaceId}
                        placeholder="Select a space"
                        options={spaces.map((s) => ({
                            label: s.name || s.external_key,
                            value: s.id,
                        }))}
                    />
                </Form.Item>
                <Form.Item
                    name="effect"
                    label="Effect"
                    rules={[{required: true, message: "Effect is required"}]}
                >
                    <Select disabled={!!grant} options={EFFECT_OPTIONS} />
                </Form.Item>
            </Form>
            <div className="mt-4 flex flex-col gap-3">
                <div className="text-xs font-medium text-colorTextSecondary">Policy</div>
                <PolicyEditor
                    value={policy}
                    onChange={setPolicy}
                    decidedBy={effectivePolicy?.decided_by}
                    editingLevel="grant"
                />
            </div>
        </Drawer>
    )
}
