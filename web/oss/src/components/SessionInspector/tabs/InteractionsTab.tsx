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
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [busyId, setBusyId] = useState<string | null>(null)

    const queryKey = ["session-inspector", "interactions", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchInteractions(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    const onRespond = async (interactionId: string) => {
        setBusyId(interactionId)
        try {
            await respondInteraction(
                interactionId,
                {answer: answers[interactionId] ?? ""},
                projectId,
            )
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
    if (!interactions.length) return <Empty description="No interactions for this session" />

    return (
        <Space direction="vertical" size="middle" className="w-full">
            {interactions.map((interaction) => {
                const id = interaction.id ?? interaction.token
                return (
                    <Card key={id} size="small" title={<Tag>{interaction.kind}</Tag>}>
                        <pre className="m-0 mb-2 max-h-[30vh] overflow-auto text-xs">
                            {JSON.stringify(interaction.data?.request ?? {}, null, 2)}
                        </pre>
                        <Space.Compact className="w-full">
                            <Input
                                placeholder="answer"
                                value={answers[id] ?? ""}
                                onChange={(e) =>
                                    setAnswers((prev) => ({...prev, [id]: e.target.value}))
                                }
                            />
                            <Button
                                type="primary"
                                loading={busyId === id}
                                disabled={!interaction.id}
                                onClick={() => interaction.id && onRespond(interaction.id)}
                            >
                                Respond
                            </Button>
                        </Space.Compact>
                    </Card>
                )
            })}
        </Space>
    )
}

export default InteractionsTab
