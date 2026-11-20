import {useCallback, useMemo, useRef, useState} from "react"

import {getDisplayContent} from "@agenta/chat/assets"
import {markSessionFresh} from "@agenta/chat/state"
import {builderAgentRevisionIdQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useQueryClient} from "@tanstack/react-query"
import type {UIMessage} from "ai"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {newId} from "@/lib/ids"

import {useAgentPanel} from "../agent-layout/agentPanelContext"
import {useAgentRow} from "../agent-layout/useAgentRow"
import {ConversationRoleContext} from "../chat/conversationRole"
import {LiveConversation} from "../chat/LiveConversation"
import {ChatLoading} from "../chat/states/ChatStates"
import {ChatUnreachable} from "../chat/states/ChatUnreachable"
import {useSessionHeader} from "../chat/useSessionHeader"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {rememberBuilderChat} from "./builderChatLink"
import {BuilderHeader, TITLE_MENU_CHATS} from "./BuilderHeader"
import {builderChatHref} from "./builderPageHref"
import type {BuilderPanelProps} from "./BuilderPanel"
import {ChatHistory} from "./ChatHistory"
import {RecentChats} from "./ChatRows"
import {ContextChip, SentContextChip} from "./ContextChip"
import {NewChatIntro} from "./NewChatIntro"
import {chatToOpen} from "./openRule"
import {parseContextLine, withContextLine, type PageContext} from "./pageContext"
import {readPagePart} from "./pagePart"
import {QuickActions} from "./QuickActions"
import {builderChatLinkVersionAtom, useBuilderChatList} from "./useBuilderChatList"

/** A new builder chat: a client-side id that becomes a server session on its first message. */
const newChatId = () => {
    const id = newId()
    // Never run: the conversation must not read its empty history as a pruned one.
    markSessionFresh(id)
    return id
}

/**
 * The chat the panel last showed, per user and project. A remount of the panel for the same agent
 * (a move between a session and an agent page) shows it again instead of running the open rule,
 * so a new chat with a draft is not lost (design D6). Another agent runs the rule.
 */
const lastShownChat = new Map<string, {agentId: string; chatId: string}>()

/** The page context line of a stored or live user message, rebuilt from its text. */
const sentContext = (message: UIMessage): PageContext | null => {
    const words = getDisplayContent(message)
    if (typeof words !== "string") return null
    const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    return parseContextLine(text, words)
}

const sentContextChip = (message: UIMessage) => {
    const context = sentContext(message)
    return context ? <SentContextChip context={context} /> : null
}

/**
 * The builder chat of one user about the agent of the screen. When it mounts and when the agent
 * changes, it opens the newest chat about the agent if it ran in the last 2 days or still runs,
 * and a new chat otherwise. A move to another session of the same agent changes nothing here:
 * only the context chip reads the page. Every message carries the page context as a context line
 * that only the model reads.
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
    const memoryKey = `${userId}:${projectId}`

    // `id` null: the open rule waits for the chat list.
    const [chat, setChat] = useState<{agentId: string; id: string | null}>(() => {
        const last = lastShownChat.get(memoryKey)
        return {agentId, id: last?.agentId === agentId ? last.chatId : null}
    })
    // Another agent on the screen: the open rule runs again, never the last agent's chat.
    if (chat.agentId !== agentId) setChat({agentId, id: null})
    const [view, setView] = useState<"chat" | "history">("chat")

    const recent = useBuilderChatList({userId, projectId, agentId, limit: TITLE_MENU_CHATS})
    const liveness = useLivenessPoll(projectId)
    const isRunning = useCallback(
        (chatId: string) =>
            Boolean(
                liveness.data?.find((stream) => stream.session_id === chatId)?.flags?.is_running,
            ),
        [liveness.data],
    )

    const show = useCallback(
        (chatId: string) => {
            lastShownChat.set(memoryKey, {agentId, chatId})
            setChat({agentId, id: chatId})
            setView("chat")
        },
        [memoryKey, agentId],
    )
    // The open rule, once the list answered (no stored chat answers at once). A failed list
    // opens a new chat; "Recent chats" then says it could not load.
    if (chat.agentId === agentId && chat.id === null && !recent.pending && !recent.stale) {
        const id = (!recent.failed && chatToOpen(recent.rows, Date.now(), isRunning)) || newChatId()
        lastShownChat.set(memoryKey, {agentId, chatId: id})
        setChat({agentId, id})
    }
    const chatId = chat.agentId === agentId ? chat.id : null
    const isNew = !chatId || !recent.chatIds.includes(chatId)

    const {row} = useAgentRow(agentId)
    const agentName = row?.name || row?.slug || ""
    const store = useStore()
    const queryClient = useQueryClient()
    const bumpLinkVersion = useSetAtom(builderChatLinkVersionAtom)
    // Read when the message leaves the composer, so the context is the page of that moment; the
    // queue keeps the result, so a retry or a resume sends the same snapshot.
    const beforeSend = useCallback(
        (text: string) => {
            if (!chatId) return undefined
            const page = readPagePart(store, queryClient, projectId)
            const context: PageContext = {
                agent: {id: agentId, name: agentName},
                ...(page ? {page} : {}),
                has_unsaved_draft: store.get(viewFormDirtyAtom),
            }
            rememberBuilderChat(userId, projectId, agentId, chatId)
            bumpLinkVersion((version) => version + 1)
            return withContextLine(context, text)
        },
        [store, queryClient, agentId, agentName, userId, projectId, chatId, bumpLinkVersion],
    )

    const header = useSessionHeader(projectId, isNew || !chatId ? "" : chatId)
    const title =
        (!isNew &&
            (header.data?.name?.trim() ||
                recent.rows.find((entry) => entry.session_id === chatId)?.name?.trim())) ||
        t("builder.panel.newChat")

    const liveStream = useMemo(
        () => liveness.data?.find((stream) => stream.session_id === chatId),
        [liveness.data, chatId],
    )

    // A ready request replaces the composer text and is not sent.
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const fillComposer = useCallback((text: string) => {
        const input = inputRef.current
        if (!input) return
        void input.setMarkdown(text).then(() => input.focus())
    }, [])

    let body
    if (builder.isPending || !chatId) body = <ChatLoading />
    else if (!builderRevisionId)
        body = (
            <ChatUnreachable onRetry={() => void builder.refetch()} retrying={builder.isFetching} />
        )
    else
        body = (
            <LiveConversation
                key={chatId}
                embedded
                entityId={builderRevisionId}
                sessionId={chatId}
                projectId={projectId}
                workspaceId={workspaceId}
                running={Boolean(liveStream?.flags?.is_running)}
                stopStateLoading={liveness.isLoading}
                sessionTurnId={liveStream?.turn_id}
                stoppingTurnId={liveStream?.stopping_turn_id}
                sharedReader={Boolean(liveStream?.capabilities?.shared_reader)}
                beforeSend={beforeSend}
                inputRef={inputRef}
                noAgentCommands
                composerPlaceholder={t("builder.panel.placeholder")}
                composerHeader={<ContextChip projectId={projectId} agentName={agentName} />}
                emptyState={<NewChatIntro agentName={agentName} />}
                belowComposer={
                    isNew ? (
                        <div className="flex flex-col gap-4 px-3 pb-3">
                            <QuickActions chatId={chatId} onPick={fillComposer} />
                            <RecentChats
                                rows={recent.rows.filter((entry) => entry.session_id !== chatId)}
                                failed={recent.failed}
                                onRetry={recent.retry}
                                onOpen={show}
                                onViewAll={() => setView("history")}
                            />
                        </div>
                    ) : null
                }
                userMessageAccessory={sentContextChip}
            />
        )

    return (
        <div data-testid="builder-panel" className="flex h-full min-h-0 flex-col">
            <BuilderHeader
                title={title}
                history={view === "history"}
                menuRows={recent.rows}
                onBack={() => setView("chat")}
                onOpenChat={show}
                onOpenHistory={() => setView("history")}
                onNewChat={() => show(newChatId())}
                openInBuilderHref={builderChatHref({
                    workspaceId,
                    projectId,
                    chatId: chatId ?? "",
                    agentId,
                })}
                onClose={() => void panel.close()}
            />
            {view === "history" ? (
                <ChatHistory
                    userId={userId}
                    projectId={projectId}
                    agentId={agentId}
                    onOpen={show}
                />
            ) : null}
            {/* The builder chat is the "embedded" conversation: its keys answer only while the
                focus is in it, never the session's own approval card. It stays mounted under the
                history, so its composer text and scroll position are there on the way back. */}
            <ConversationRoleContext.Provider value="embedded">
                <div className={view === "history" ? "hidden" : "min-h-0 flex-1"}>{body}</div>
            </ConversationRoleContext.Provider>
        </div>
    )
}
