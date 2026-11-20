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
import {sessionToOpen} from "./openRule"
import {parseSentContextLine, withContextLine, type PageContext} from "./pageContext"
import {readPagePart} from "./pagePart"
import {QuickActions} from "./QuickActions"
import {builderChatLinkVersionAtom, useBuilderChatList} from "./useBuilderChatList"

/** A new builder chat: a client-side id that becomes a server session on its first message. */
const newBuilderSessionId = () => {
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
const lastShownChat = new Map<string, {agentId: string; builderSessionId: string}>()

/** The page context line of a stored or live user message, rebuilt from its text. */
const sentContext = (message: UIMessage): PageContext | null => {
    const words = getDisplayContent(message)
    if (typeof words !== "string") return null
    const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    return parseSentContextLine(text, words)
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

    // Null: the open rule waits for the chat list. Mounted per agent (`BuilderPanel` keys it), so
    // another agent runs the rule again and never shows the last agent's chat.
    const [builderSessionId, setBuilderSessionId] = useState<string | null>(() => {
        const last = lastShownChat.get(memoryKey)
        return last?.agentId === agentId ? last.builderSessionId : null
    })
    const [view, setView] = useState<"chat" | "history">("chat")

    const recent = useBuilderChatList({userId, projectId, agentId})
    const liveness = useLivenessPoll(projectId)
    const isRunning = useCallback(
        (builderSessionId: string) =>
            Boolean(
                liveness.data?.find((stream) => stream.session_id === builderSessionId)?.flags
                    ?.is_running,
            ),
        [liveness.data],
    )

    const show = useCallback(
        (id: string) => {
            lastShownChat.set(memoryKey, {agentId, builderSessionId: id})
            setBuilderSessionId(id)
            setView("chat")
        },
        [memoryKey, agentId],
    )
    // The open rule, once the list answered (no stored chat answers at once). A failed list
    // opens a new chat; "Recent chats" then says it could not load.
    if (builderSessionId === null && !recent.pending && !recent.stale) {
        const id =
            (!recent.failed && sessionToOpen(recent.rows, Date.now(), isRunning)) ||
            newBuilderSessionId()
        lastShownChat.set(memoryKey, {agentId, builderSessionId: id})
        setBuilderSessionId(id)
    }
    // Not linked to the agent yet: a chat with no message.
    const isUnlinked = !builderSessionId || !recent.sessionIds.includes(builderSessionId)

    const {row} = useAgentRow(agentId)
    const agentName = row?.name || row?.slug || ""
    const store = useStore()
    const queryClient = useQueryClient()
    const bumpLinkVersion = useSetAtom(builderChatLinkVersionAtom)
    // Read when the message leaves the composer, so the context is the page of that moment; the
    // queue keeps the result, so a retry or a resume sends the same snapshot.
    const beforeSend = useCallback(
        (text: string) => {
            if (!builderSessionId) return undefined
            const page = readPagePart(store, queryClient, projectId)
            const context: PageContext = {
                agent: {id: agentId, name: agentName},
                ...(page ? {page} : {}),
                has_unsaved_draft: store.get(viewFormDirtyAtom),
            }
            if (rememberBuilderChat(userId, projectId, agentId, builderSessionId))
                bumpLinkVersion((version) => version + 1)
            return withContextLine(context, text)
        },
        [
            store,
            queryClient,
            agentId,
            agentName,
            userId,
            projectId,
            builderSessionId,
            bumpLinkVersion,
        ],
    )

    const header = useSessionHeader(
        projectId,
        isUnlinked || !builderSessionId ? "" : builderSessionId,
    )
    const title =
        (!isUnlinked &&
            (header.data?.name?.trim() ||
                recent.rows
                    .find((entry) => entry.session_id === builderSessionId)
                    ?.name?.trim())) ||
        t("builder.panel.newChat")

    const liveStream = useMemo(
        () => liveness.data?.find((stream) => stream.session_id === builderSessionId),
        [liveness.data, builderSessionId],
    )

    // A ready request replaces the composer text and is not sent.
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const fillComposer = useCallback((text: string) => {
        const input = inputRef.current
        if (!input) return
        void input.setMarkdown(text).then(() => input.focus())
    }, [])

    let body
    if (builder.isPending || !builderSessionId) body = <ChatLoading />
    else if (!builderRevisionId)
        body = (
            <ChatUnreachable onRetry={() => void builder.refetch()} retrying={builder.isFetching} />
        )
    else
        body = (
            <LiveConversation
                key={builderSessionId}
                embedded
                entityId={builderRevisionId}
                sessionId={builderSessionId}
                projectId={projectId}
                workspaceId={workspaceId}
                running={Boolean(liveStream?.flags?.is_running)}
                stopStateLoading={liveness.isLoading}
                sessionTurnId={liveStream?.turn_id}
                stoppingTurnId={liveStream?.stopping_turn_id}
                sharedReader={Boolean(liveStream?.capabilities?.shared_reader)}
                beforeSend={beforeSend}
                inputRef={inputRef}
                hideSlashCommands
                composerPlaceholder={t("builder.panel.placeholder")}
                composerHeader={<ContextChip projectId={projectId} agentName={agentName} />}
                emptyState={<NewChatIntro agentName={agentName} />}
                belowComposer={
                    isUnlinked ? (
                        <div className="flex flex-col gap-4 px-3 pb-3">
                            <QuickActions
                                sessionId={builderSessionId}
                                onPick={fillComposer}
                            />
                            <RecentChats
                                rows={recent.rows.filter(
                                    (entry) => entry.session_id !== builderSessionId,
                                )}
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
                menuRows={recent.rows.slice(0, TITLE_MENU_CHATS)}
                onBack={() => setView("chat")}
                onOpenChat={show}
                onOpenHistory={() => setView("history")}
                onNewChat={() => show(newBuilderSessionId())}
                openInBuilderHref={builderChatHref({
                    workspaceId,
                    projectId,
                    sessionId: builderSessionId ?? "",
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
