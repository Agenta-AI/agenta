import {CommentOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Empty, Form, Input, Modal, Select, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useState} from "react"

import {AgentRevisionBadge} from "@/features/agents/AgentRevisionBadge"
import {agentsQueryAtom} from "@/lib/state/agents"
import {createSession, sessionsQueryAtom} from "@/lib/state/sessions"

export const SessionList = ({
    selectedId,
    select,
}: {
    selectedId?: string
    select: (id: string) => void
}) => {
    const sessions = useAtomValue(sessionsQueryAtom)
    const agents = useAtomValue(agentsQueryAtom)
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [form] = Form.useForm()
    const revisionById = new Map(
        (agents.data ?? []).map((agent) => [
            agent.current_revision.id,
            agent.current_revision.version,
        ]),
    )

    const create = async (values: {agentId: string; title?: string}) => {
        const agent = agents.data?.find((item) => item.id === values.agentId)
        if (!agent) return
        setCreating(true)
        try {
            const session = await createSession(agent.current_revision.id, values.title)
            form.resetFields()
            setOpen(false)
            select(session.id)
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="entity-list-wrap">
            <div className="entity-list-head">
                <div>
                    <Typography.Title level={4}>Sessions</Typography.Title>
                    <span>{sessions.data?.length ?? 0}</span>
                </div>
                <Button
                    type="text"
                    icon={<PlusOutlined />}
                    aria-label="New session"
                    disabled={!agents.data?.length}
                    onClick={() => setOpen(true)}
                />
            </div>
            {sessions.isPending ? (
                <div className="list-state">
                    <Skeleton active />
                    <Skeleton active />
                </div>
            ) : sessions.isError ? (
                <Typography.Text type="danger">Sessions could not be loaded.</Typography.Text>
            ) : !sessions.data.length ? (
                <Empty
                    image={<CommentOutlined className="empty-icon" />}
                    description="No sessions yet"
                >
                    <Button
                        type="primary"
                        disabled={!agents.data?.length}
                        onClick={() => setOpen(true)}
                    >
                        Start a session
                    </Button>
                </Empty>
            ) : (
                <div className="entity-list" role="listbox" aria-label="Sessions">
                    {sessions.data.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            role="option"
                            aria-selected={session.id === selectedId}
                            className={
                                session.id === selectedId ? "entity-row active" : "entity-row"
                            }
                            onClick={() => select(session.id)}
                        >
                            <span className="entity-avatar">
                                <CommentOutlined />
                            </span>
                            <span className="entity-copy">
                                <strong>{session.title || "Untitled session"}</strong>
                                <small>{new Date(session.updated_at).toLocaleString()}</small>
                            </span>
                            {revisionById.get(session.agent_revision_id) ? (
                                <AgentRevisionBadge
                                    version={revisionById.get(session.agent_revision_id)!}
                                />
                            ) : null}
                        </button>
                    ))}
                </div>
            )}
            <Modal
                title="Start a new session"
                open={open}
                onCancel={() => setOpen(false)}
                footer={null}
            >
                <Form form={form} layout="vertical" onFinish={(values) => void create(values)}>
                    <Form.Item label="Agent" name="agentId" rules={[{required: true}]}>
                        <Select
                            size="large"
                            options={(agents.data ?? []).map((agent) => ({
                                value: agent.id,
                                label: `${agent.name} · v${agent.current_revision.version}`,
                            }))}
                            placeholder="Choose an agent"
                        />
                    </Form.Item>
                    <Form.Item label="Session title" name="title">
                        <Input size="large" placeholder="Optional" />
                    </Form.Item>
                    <Button block size="large" type="primary" htmlType="submit" loading={creating}>
                        Start session
                    </Button>
                </Form>
            </Modal>
        </div>
    )
}
