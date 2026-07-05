import {useState} from "react"

import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {Card, CardContent, CardHeader, CardTitle} from "@agenta/primitive-ui/components/card"
import {Input} from "@agenta/primitive-ui/components/input"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {message} from "@agenta/ui/app-message"
import {WarningCircle} from "@phosphor-icons/react"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Empty, Space, Tag} from "antd"
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

    const refresh = () => queryClient.invalidateQueries({queryKey})

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

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/5" />
            </div>
        )
    if (error)
        return (
            <Alert variant="destructive" icon={<WarningCircle size={16} />}>
                <AlertTitle>Failed to load interactions</AlertTitle>
            </Alert>
        )

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
                        <Card key={id || interaction.token} size="sm">
                            <CardHeader>
                                <CardTitle>
                                    <Space size="small">
                                        <Tag>{interaction.kind}</Tag>
                                        <Tag color={isPending ? "orange" : "default"}>
                                            {interaction.status?.code ?? "unknown"}
                                        </Tag>
                                    </Space>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Space direction="vertical" size="small" className="w-full">
                                    <div className="text-xs text-gray-500">
                                        <span className="font-mono">{interaction.token}</span>
                                        {interaction.turn_id && (
                                            <span className="ml-2 text-gray-400">
                                                turn:{" "}
                                                <span className="font-mono">
                                                    {interaction.turn_id}
                                                </span>
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
                                                disabled={!isPending || !id || busyId === id}
                                                onClick={() =>
                                                    id &&
                                                    respond(
                                                        id,
                                                        approvalAnswer(interaction.token, true),
                                                    )
                                                }
                                                size="sm"
                                            >
                                                {busyId === id ? <Spinner /> : null}
                                                Approve
                                            </Button>
                                            <Button
                                                disabled={!isPending || !id || busyId === id}
                                                onClick={() =>
                                                    id &&
                                                    respond(
                                                        id,
                                                        approvalAnswer(interaction.token, false),
                                                    )
                                                }
                                                variant="destructive"
                                                size="sm"
                                            >
                                                {busyId === id ? <Spinner /> : null}
                                                Deny
                                            </Button>
                                        </Space>
                                    ) : (
                                        <Space.Compact className="w-full">
                                            <Input
                                                placeholder="input"
                                                value={inputs[id] ?? ""}
                                                disabled={!isPending}
                                                onChange={(e) =>
                                                    setInputs((prev) => ({
                                                        ...prev,
                                                        [id]: e.target.value,
                                                    }))
                                                }
                                                className="h-6"
                                            />
                                            <Button
                                                disabled={!isPending || !id || busyId === id}
                                                onClick={() =>
                                                    id && respond(id, inputAnswer(inputs[id] ?? ""))
                                                }
                                                variant="outline"
                                                size="sm"
                                            >
                                                {busyId === id ? <Spinner /> : null}
                                                Respond
                                            </Button>
                                        </Space.Compact>
                                    )}
                                </Space>
                            </CardContent>
                        </Card>
                    )
                })
            )}
            <div className="mt-2">
                <Button onClick={refresh} variant="ghost">
                    Refresh
                </Button>
            </div>
        </Space>
    )
}

export default InteractionsTab
