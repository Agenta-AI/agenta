import {useState} from "react"

import {message} from "@agenta/ui/app-message"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Button, Card, Empty, Input, Skeleton, Space, Tag} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchInteractions, respondInteraction} from "../api"

const InteractionsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()
    const [inputs, setInputs] = useState<Record<string, string>>({})
    const [busyId, setBusyId] = useState<string | null>(null)

    const queryKey = ["session-inspector", "interactions", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchInteractions(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    // Resolving an interaction is a detached agent invoke: the answer is one message in
    // `inputs.messages`, in the neutral agenta format (the invoke path does not negotiate
    // Vercel). An approval reply is a `tool_result` content block keyed by the gated
    // tool-call id (the interaction token) carrying `{approved}` — what the runner resolves
    // a parked gate from. A user_input reply is an ordinary user text message.
    const approvalAnswer = (token: string, approved: boolean) => ({
        messages: [
            {
                role: "user",
                content: [{type: "tool_result", toolCallId: token, output: {approved}}],
            },
        ],
    })
    const inputAnswer = (text: string) => ({
        messages: [{role: "user", content: text}],
    })

    const respond = async (interactionId: string, answer: Record<string, unknown>) => {
        setBusyId(interactionId)
        try {
            await respondInteraction(interactionId, answer, projectId)
            message.success("Responded")
            await queryClient.invalidateQueries({queryKey})
        } catch {
            message.error("Respond failed")
        } finally {
            setBusyId(null)
        }
    }

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load interactions" showIcon />

    const interactions = data?.interactions ?? []

    return (
        <Space direction="vertical" size="middle" className="w-full">
            {interactions.length === 0 ? (
                <Empty description="No interactions for this session" />
            ) : (
                interactions.map((interaction) => {
                    const id = interaction.id ?? ""
                    const isPending = interaction.status?.code === "pending"
                    const isApproval = interaction.kind === "user_approval"

                    return (
                        <Card
                            key={id || interaction.token}
                            size="small"
                            title={
                                <Space size="small">
                                    <Tag>{interaction.kind}</Tag>
                                    <Tag color={isPending ? "orange" : "default"}>
                                        {interaction.status?.code ?? "unknown"}
                                    </Tag>
                                </Space>
                            }
                        >
                            <Space direction="vertical" size="small" className="w-full">
                                <div className="text-xs text-gray-500">
                                    <span className="font-mono">{interaction.token}</span>
                                    {interaction.turn_id && (
                                        <span className="ml-2 text-gray-400">
                                            turn:{" "}
                                            <span className="font-mono">{interaction.turn_id}</span>
                                        </span>
                                    )}
                                    {interaction.created_at && (
                                        <span className="ml-2 text-gray-400">
                                            {String(interaction.created_at)}
                                        </span>
                                    )}
                                </div>
                                {interaction.data?.request && (
                                    <pre className="m-0 max-h-[20vh] overflow-auto rounded bg-gray-50 p-2 text-xs">
                                        {JSON.stringify(interaction.data.request, null, 2)}
                                    </pre>
                                )}
                                {interaction.data?.resolution && (
                                    <pre className="m-0 max-h-[10vh] overflow-auto rounded bg-green-50 p-2 text-xs">
                                        {JSON.stringify(interaction.data.resolution, null, 2)}
                                    </pre>
                                )}
                                {isApproval ? (
                                    <Space>
                                        <Button
                                            type="primary"
                                            size="small"
                                            loading={busyId === id}
                                            disabled={!isPending || !id}
                                            onClick={() =>
                                                id &&
                                                respond(id, approvalAnswer(interaction.token, true))
                                            }
                                        >
                                            Approve
                                        </Button>
                                        <Button
                                            danger
                                            size="small"
                                            loading={busyId === id}
                                            disabled={!isPending || !id}
                                            onClick={() =>
                                                id &&
                                                respond(
                                                    id,
                                                    approvalAnswer(interaction.token, false),
                                                )
                                            }
                                        >
                                            Deny
                                        </Button>
                                    </Space>
                                ) : (
                                    <Space.Compact className="w-full">
                                        <Input
                                            size="small"
                                            placeholder="input"
                                            value={inputs[id] ?? ""}
                                            disabled={!isPending}
                                            onChange={(e) =>
                                                setInputs((prev) => ({
                                                    ...prev,
                                                    [id]: e.target.value,
                                                }))
                                            }
                                        />
                                        <Button
                                            size="small"
                                            loading={busyId === id}
                                            disabled={!isPending || !id}
                                            onClick={() =>
                                                id && respond(id, inputAnswer(inputs[id] ?? ""))
                                            }
                                        >
                                            Respond
                                        </Button>
                                    </Space.Compact>
                                )}
                            </Space>
                        </Card>
                    )
                })
            )}
        </Space>
    )
}

export default InteractionsTab
