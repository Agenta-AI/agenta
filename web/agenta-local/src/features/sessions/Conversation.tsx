import {ArrowLeftOutlined} from "@ant-design/icons"
import {Button, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRef, useState} from "react"

import {AgentRevisionBadge} from "@/features/agents/AgentRevisionBadge"
import {LocalApiError} from "@/lib/api/client"
import {agentsQueryAtom} from "@/lib/state/agents"
import {selectedSessionQueryAtom, stopTurn, streamTurn} from "@/lib/state/sessions"

import {Composer} from "./Composer"
import {MessageList, type LiveAttempt} from "./MessageList"
import {ConversationError} from "./states/ConversationError"
import {ConversationSkeleton} from "./states/ConversationSkeleton"

export const Conversation = ({sessionId, back}: {sessionId: string; back: () => void}) => {
    const session = useAtomValue(selectedSessionQueryAtom)
    const agents = useAtomValue(agentsQueryAtom)
    const [draft, setDraft] = useState("")
    const [attempt, setAttempt] = useState<LiveAttempt | null>(null)
    const [busy, setBusy] = useState(false)
    const [stopping, setStopping] = useState(false)
    const activeId = useRef<string | null>(null)
    const controller = useRef<AbortController | null>(null)
    const stopPending = useRef(false)

    const send = async (textOverride?: string) => {
        const text = (textOverride ?? draft).trim()
        if (!text || activeId.current) return
        const clientTurnId = crypto.randomUUID()
        activeId.current = clientTurnId
        controller.current = new AbortController()
        setBusy(true)
        setAttempt({input: text, output: "", status: "streaming"})
        if (!textOverride) setDraft("")

        let terminal: LiveAttempt["status"] | null = null
        let terminalError: string | undefined
        try {
            for await (const frame of streamTurn(
                sessionId,
                text,
                clientTurnId,
                controller.current.signal,
            )) {
                if (frame.type === "text-delta" && typeof frame.delta === "string") {
                    setAttempt((current) =>
                        current ? {...current, output: current.output + frame.delta} : current,
                    )
                } else if (
                    frame.type === "data-agent-error" &&
                    typeof frame.data === "object" &&
                    frame.data
                ) {
                    terminal = "failed"
                    terminalError =
                        "errorText" in frame.data
                            ? String(frame.data.errorText)
                            : "The provider rejected this turn."
                } else if (frame.type === "error") {
                    terminal = "failed"
                    terminalError =
                        typeof frame.errorText === "string" ? frame.errorText : "The runner failed."
                } else if (frame.type === "tool-output-denied") {
                    terminal = "denied"
                    terminalError = "A tool request was denied by the local policy."
                }
            }
            if (terminal) {
                setAttempt((current) =>
                    current ? {...current, status: terminal!, error: terminalError} : current,
                )
                setDraft(text)
            } else {
                setAttempt(null)
                await session.refetch()
            }
        } catch (reason) {
            const cancelled = reason instanceof LocalApiError && reason.code === "turn_cancelled"
            const disconnected =
                reason instanceof LocalApiError && reason.code === "stream_disconnected"
            setAttempt((current) =>
                current
                    ? {
                          ...current,
                          status: cancelled ? "cancelled" : disconnected ? "interrupted" : "failed",
                          error: cancelled
                              ? "Stopped by you."
                              : reason instanceof Error
                                ? reason.message
                                : "The turn failed.",
                      }
                    : current,
            )
            setDraft(text)
            await session.refetch()
        } finally {
            activeId.current = null
            controller.current = null
            stopPending.current = false
            setBusy(false)
            setStopping(false)
        }
    }

    const stop = async () => {
        if (!activeId.current || stopPending.current) return
        stopPending.current = true
        setStopping(true)
        try {
            await stopTurn(sessionId)
            controller.current?.abort()
        } catch {
            stopPending.current = false
            setStopping(false)
        }
    }

    if (session.isPending) return <ConversationSkeleton />
    if (session.isError) return <ConversationError retry={() => void session.refetch()} />

    const revisionVersion = agents.data?.find(
        (item) => item.current_revision.id === session.data.agent_revision_id,
    )?.current_revision.version

    return (
        <div className="conversation">
            <header className="conversation-header">
                <Button
                    className="mobile-back"
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    onClick={back}
                    aria-label="Back to sessions"
                />
                <div>
                    <Typography.Title level={4}>
                        {session.data.title || "Untitled session"}
                    </Typography.Title>
                    <Typography.Text type="secondary">Bound to revision</Typography.Text>
                    {revisionVersion ? (
                        <AgentRevisionBadge version={revisionVersion} />
                    ) : (
                        <Typography.Text type="secondary" code>
                            {session.data.agent_revision_id.slice(-8)}
                        </Typography.Text>
                    )}
                </div>
                <Tag color={busy ? "processing" : "default"}>{busy ? "Running" : "Ready"}</Tag>
            </header>
            <div className="conversation-scroll">
                {!session.data.messages.length && !attempt ? (
                    <div className="conversation-welcome">
                        <span className="spark">A</span>
                        <Typography.Title level={3}>What should we work on?</Typography.Title>
                        <Typography.Paragraph type="secondary">
                            This conversation stays on your machine.
                        </Typography.Paragraph>
                    </div>
                ) : (
                    <MessageList
                        messages={session.data.messages}
                        attempt={attempt}
                        retry={() => void send(attempt?.input)}
                    />
                )}
            </div>
            <Composer
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                stopping={stopping}
                send={() => void send()}
                stop={() => void stop()}
            />
        </div>
    )
}
