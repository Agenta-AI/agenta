import {useState} from "react"

import {Button, Form, Input, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {createAgentaConnection} from "../api"
import {selectedConnectionIdAtom} from "../state"

interface CreateBotFormValues {
    slug: string
    name?: string
}

/** Form 1 of 3: create a bot -- a connection whose channel is "agenta". */
export default function CreateBotForm() {
    const [form] = Form.useForm<CreateBotFormValues>()
    const projectId = useAtomValue(projectIdAtom)
    const setSelectedConnectionId = useSetAtom(selectedConnectionIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const [isSaving, setIsSaving] = useState(false)

    const handleSubmit = async () => {
        const values = await form.validateFields()
        if (!projectId) return
        setIsSaving(true)
        try {
            const connection = await createAgentaConnection({
                slug: values.slug,
                name: values.name,
                projectId,
                bot: values.slug,
            })
            queryClient.invalidateQueries({queryKey: ["agenta-channel-surface", "connections"]})
            if (connection?.id) setSelectedConnectionId(connection.id)
            message.success("Bot created")
            form.resetFields()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to create bot")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Form form={form} layout="inline" onFinish={handleSubmit}>
            <Form.Item name="slug" rules={[{required: true, message: "Slug is required"}]}>
                <Input placeholder="bot slug" />
            </Form.Item>
            <Form.Item name="name">
                <Input placeholder="Name (optional)" />
            </Form.Item>
            <Form.Item>
                <Button type="primary" htmlType="submit" loading={isSaving}>
                    Create bot
                </Button>
            </Form.Item>
        </Form>
    )
}
