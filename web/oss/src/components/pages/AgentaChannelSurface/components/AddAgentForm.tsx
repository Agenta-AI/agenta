import {useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Button, Form, Input, Switch, message} from "antd"
import {useAtomValue} from "jotai"

import {useChannelAgentActions} from "@/oss/state/channels"

import {selectedConnectionIdAtom} from "../state"

interface AddAgentFormValues {
    slug: string
    workflowId: string
    makeDefault: boolean
}

/** Form 2 of 3: add an agent by slug, referencing an existing workflow, optionally marked default. */
export default function AddAgentForm() {
    const [form] = Form.useForm<AddAgentFormValues>()
    const connectionId = useAtomValue(selectedConnectionIdAtom)
    const {create, setDefault} = useChannelAgentActions()
    const [isSaving, setIsSaving] = useState(false)

    const handleSubmit = async () => {
        const values = await form.validateFields()
        if (!connectionId) return
        setIsSaving(true)
        try {
            const data: AgentaApi.ChannelAgentData = {references: {main: {id: values.workflowId}}}
            const result = await create({
                slug: values.slug,
                connection_id: connectionId,
                data,
            })
            if (values.makeDefault && result.agent?.id) {
                await setDefault(result.agent.id)
            }
            message.success("Agent added")
            form.resetFields()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to add agent")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Form form={form} layout="inline" onFinish={handleSubmit} disabled={!connectionId}>
            <Form.Item name="slug" rules={[{required: true, message: "Slug is required"}]}>
                <Input placeholder="agent slug" />
            </Form.Item>
            <Form.Item
                name="workflowId"
                rules={[{required: true, message: "Workflow id is required"}]}
            >
                <Input placeholder="workflow id" />
            </Form.Item>
            <Form.Item name="makeDefault" valuePropName="checked" initialValue={true}>
                <Switch checkedChildren="default" unCheckedChildren="default" />
            </Form.Item>
            <Form.Item>
                <Button type="primary" htmlType="submit" loading={isSaving}>
                    Add agent
                </Button>
            </Form.Item>
        </Form>
    )
}
