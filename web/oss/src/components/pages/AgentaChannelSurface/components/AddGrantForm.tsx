import {useMemo, useState} from "react"

import {Button, Form, Select, message} from "antd"
import {useAtomValue} from "jotai"

import {useChannelAgentsQuery} from "@/oss/state/channels"

import {createAgentaGrant} from "../api"
import {selectedConnectionIdAtom} from "../state"

interface AddGrantFormValues {
    agentId: string
}

/** Form 3 of 3: the one grant this surface needs -- ALLOW, kind = private. */
export default function AddGrantForm() {
    const [form] = Form.useForm<AddGrantFormValues>()
    const connectionId = useAtomValue(selectedConnectionIdAtom)
    const {agents} = useChannelAgentsQuery()
    const [isSaving, setIsSaving] = useState(false)

    const agentsForConnection = useMemo(
        () => agents.filter((agent) => agent.connection_id === connectionId),
        [agents, connectionId],
    )

    const handleSubmit = async () => {
        const values = await form.validateFields()
        setIsSaving(true)
        try {
            await createAgentaGrant({agentId: values.agentId, kind: "private"})
            message.success("Grant created (allow, private)")
            form.resetFields()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to create grant")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Form form={form} layout="inline" onFinish={handleSubmit} disabled={!connectionId}>
            <Form.Item name="agentId" rules={[{required: true, message: "Agent is required"}]}>
                <Select
                    className="min-w-[180px]"
                    placeholder="Select an agent"
                    options={agentsForConnection.map((agent) => ({
                        label: agent.name || agent.slug,
                        value: agent.id,
                    }))}
                />
            </Form.Item>
            <Form.Item>
                <Button type="primary" htmlType="submit" loading={isSaving}>
                    Grant (allow, private)
                </Button>
            </Form.Item>
        </Form>
    )
}
