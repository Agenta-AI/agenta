import {useMemo, useState} from "react"

import {Button, Input, Switch, Typography, message} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {createApiKey} from "@/oss/services/apiKeys/api"
import {useOrgData} from "@/oss/state/org"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"

import {postAgentaEvent} from "../api"
import {
    agentaApiKeyAtom,
    agentaConnectionsQueryAtom,
    agentaConversationQueryAtomFamily,
    agentaSpaceForConnectionQueryAtomFamily,
    agentaThreadsForSpaceQueryAtomFamily,
    degradedRenderingAtom,
    selectedConnectionIdAtom,
} from "../state"

import NodeRenderer from "./nodes/NodeRenderer"
import {parseAgentaNode} from "./nodes/types"

export default function ConversationPanel() {
    const projectId = useAtomValue(projectIdAtom)
    const user = useAtomValue(userAtom)
    const {selectedOrg} = useOrgData()
    const workspaceId = selectedOrg?.default_workspace?.id ?? ""

    const connectionId = useAtomValue(selectedConnectionIdAtom)
    const connectionsQuery = useAtomValue(agentaConnectionsQueryAtom)
    const [apiKey, setApiKey] = useAtom(agentaApiKeyAtom)
    const [degraded, setDegraded] = useAtom(degradedRenderingAtom)
    const [draft, setDraft] = useState("")
    const [isSending, setIsSending] = useState(false)
    const [isMintingKey, setIsMintingKey] = useState(false)

    const userId = user?.id ?? ""
    const connection = (connectionsQuery.data ?? []).find((c) => c.id === connectionId)
    const bot = (connection?.data?.bot as string | undefined) ?? connection?.slug ?? ""

    const spaceQuery = useAtomValue(
        agentaSpaceForConnectionQueryAtomFamily({connectionId: connectionId ?? "", userId}),
    )
    const spaceId = spaceQuery.data?.id ?? null

    const threadsQuery = useAtomValue(agentaThreadsForSpaceQueryAtomFamily(spaceId ?? ""))
    const conversationQuery = useAtomValue(agentaConversationQueryAtomFamily(spaceId ?? ""))

    const canSend = !!connectionId && !!bot && !!apiKey && !!projectId && !!userId

    const send = async (text: string) => {
        if (!canSend || !text.trim()) return
        setIsSending(true)
        try {
            await postAgentaEvent({apiKey, projectId: projectId!, bot, userId, text})
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to send")
        } finally {
            setIsSending(false)
        }
    }

    const handleSend = async () => {
        const text = draft
        setDraft("")
        await send(text)
    }

    const handleNewConversation = () => send("!new")

    const handleMintKey = async () => {
        if (!workspaceId) return
        setIsMintingKey(true)
        try {
            const {data} = await createApiKey(workspaceId)
            setApiKey(data)
            message.success("New API key minted -- kept in memory only, not saved.")
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to create an API key")
        } finally {
            setIsMintingKey(false)
        }
    }

    const items = useMemo(() => conversationQuery.data?.items ?? [], [conversationQuery.data])

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <Input.Password
                    className="max-w-[260px]"
                    placeholder="Your Agenta API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                    size="small"
                    onClick={handleMintKey}
                    loading={isMintingKey}
                    disabled={!workspaceId}
                >
                    Create new key
                </Button>
                <span className="ml-auto flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Switch size="small" checked={degraded} onChange={setDegraded} />
                    Degrade to text
                </span>
            </div>

            {!connectionId ? (
                <Typography.Text type="secondary">Pick or create a bot above.</Typography.Text>
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        <Typography.Text type="secondary" className="text-xs">
                            {threadsQuery.data?.threads?.length ?? 0} conversation(s) in this space
                        </Typography.Text>
                        <Button size="small" onClick={handleNewConversation} disabled={!canSend}>
                            New conversation
                        </Button>
                    </div>

                    <div className="flex min-h-[200px] flex-col gap-3 rounded border border-colorBorder p-3">
                        {items.length === 0 && (
                            <Typography.Text type="secondary">
                                No messages yet -- send one below.
                            </Typography.Text>
                        )}
                        {items.map((item) => (
                            <div
                                key={item.id}
                                className={
                                    item.direction === "outbound"
                                        ? "self-start rounded bg-colorFillTertiary p-2"
                                        : "self-end rounded bg-colorFillSecondary p-2"
                                }
                            >
                                {item.content.map((part, index) => {
                                    const node = parseAgentaNode(part)
                                    if (!node) return null
                                    return (
                                        <NodeRenderer
                                            key={index}
                                            node={node}
                                            degraded={degraded}
                                            onChoice={(token) => send(token)}
                                        />
                                    )
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2">
                        <Input
                            placeholder={
                                canSend ? "Type a message" : "Pick a bot and paste an API key first"
                            }
                            value={draft}
                            disabled={!canSend}
                            onChange={(e) => setDraft(e.target.value)}
                            onPressEnter={handleSend}
                        />
                        <Button
                            type="primary"
                            onClick={handleSend}
                            loading={isSending}
                            disabled={!canSend}
                        >
                            Send
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}
