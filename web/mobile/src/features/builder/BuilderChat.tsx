import {useCallback, useMemo, useState} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {builderAgentRevisionIdQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {Button} from "@agenta/ui/ui"
import {Plus, X} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {newId} from "@/lib/ids"

import {useAgentPanel} from "../agent-layout/agentPanelContext"
import {useAgentRow} from "../agent-layout/useAgentRow"
import {ConversationRoleContext} from "../chat/conversationRole"
import {LiveConversation} from "../chat/LiveConversation"
import {ChatLoading} from "../chat/states/ChatStates"
import {ChatUnreachable} from "../chat/states/ChatUnreachable"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {readBuilderChats, rememberBuilderChat} from "./builderChatLink"
import type {BuilderPanelProps} from "./BuilderPanel"
import {pageContextAtom, withContextLine, type PageContext} from "./pageContext"

/** A new builder chat: a client-side id that becomes a server session on its first message. */
const newChatId = () => {
    const id = newId()
    // Never run: the conversation must not read its empty history as a pruned one.
    markSessionFresh(id)
    return id
}

/**
 * The builder chat of one user about the agent of the screen. It opens the newest chat this
 * browser links to the agent, or a new chat. Every message carries the page context as a context
 * line that only the model reads.
 */
export const BuilderChat = ({
    agentId,
    workspaceId,
    projectId,
    userId,
}: BuilderPanelProps & {userId: string}) => {
    const t = useT(builderPanelCatalog)
    const panel = useAgentPanel()
    const builder = useAtomValue(builderAgentRevisionIdQueryAtom)
    const builderRevisionId = builder.data ?? null
    const [chat, setChat] = useState(() => ({
        agentId,
        id: readBuilderChats(userId, projectId, agentId)[0] ?? newChatId(),
    }))
    // Another agent on the screen: its own newest chat, never the last agent's.
    if (chat.agentId !== agentId)
        setChat({agentId, id: readBuilderChats(userId, projectId, agentId)[0] ?? newChatId()})

    const {row} = useAgentRow(agentId)
    const agentName = row?.name || row?.slug || ""
    const store = useStore()
    // Read when the message leaves the composer, so the context is the page of that moment; the
    // queue keeps the result, so a retry or a resume sends the same snapshot.
    const beforeSend = useCallback(
        (text: string) => {
            const page = store.get(pageContextAtom)
            const context: PageContext = {
                agent: {id: agentId, name: agentName},
                ...(page ? {page} : {}),
                has_unsaved_draft: store.get(viewFormDirtyAtom),
            }
            rememberBuilderChat(userId, projectId, agentId, chat.id)
            return withContextLine(context, text)
        },
        [store, agentId, agentName, userId, projectId, chat.id],
    )

    const liveness = useLivenessPoll(projectId)
    const liveStream = useMemo(
        () => liveness.data?.find((stream) => stream.session_id === chat.id),
        [liveness.data, chat.id],
    )

    let body
    if (builder.isPending) body = <ChatLoading />
    else if (!builderRevisionId)
        body = (
            <ChatUnreachable onRetry={() => void builder.refetch()} retrying={builder.isFetching} />
        )
    else
        body = (
            <LiveConversation
                key={chat.id}
                embedded
                entityId={builderRevisionId}
                sessionId={chat.id}
                projectId={projectId}
                workspaceId={workspaceId}
                running={Boolean(liveStream?.flags?.is_running)}
                stopStateLoading={liveness.isLoading}
                sessionTurnId={liveStream?.turn_id}
                stoppingTurnId={liveStream?.stopping_turn_id}
                sharedReader={Boolean(liveStream?.capabilities?.shared_reader)}
                beforeSend={beforeSend}
            />
        )

    return (
        <div data-testid="builder-panel" className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-end gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2 py-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChat({agentId, id: newChatId()})}
                >
                    <Plus aria-hidden data-icon="inline-start" />
                    {t("builder.panel.newChat")}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("builder.panel.close")}
                    title={t("builder.panel.close")}
                    onClick={() => void panel.close()}
                >
                    <X aria-hidden />
                </Button>
            </div>
            {/* The builder chat is the "embedded" conversation: its keys answer only while the
                focus is in it, never the session's own approval card. */}
            <ConversationRoleContext.Provider value="embedded">
                <div className="min-h-0 flex-1">{body}</div>
            </ConversationRoleContext.Provider>
        </div>
    )
}
