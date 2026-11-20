import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {builderAgentRevisionIdQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentLayoutPhoneCatalog from "@agenta/i18n/catalogs/agentLayout.phone"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useQueryClient} from "@tanstack/react-query"
import type {UIMessage} from "ai"
import {atom, useAtomValue, useSetAtom, useStore} from "jotai"

import {useAgentPanel} from "../agent-layout/agentPanelContext"
import {useAgentRow} from "../agent-layout/useAgentRow"
import {BuilderChatContext} from "../chat/builderChat"
import {ConversationRoleContext} from "../chat/conversationRole"
import {LiveConversation} from "../chat/LiveConversation"
import {pageSessionIdAtom} from "../chat/pageSessionId"
import {ChatLoading} from "../chat/states/ChatStates"
import {ChatUnreachable} from "../chat/states/ChatUnreachable"
import {useSessionHeader} from "../chat/useSessionHeader"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {builderChatHref} from "./builderChatHref"
import {rememberBuilderChat} from "./builderChatLink"
import {BuilderHeader, TITLE_MENU_CHATS} from "./BuilderHeader"
import type {BuilderPanelProps} from "./BuilderPanel"
import {ChatHistory} from "./ChatHistory"
import {ContextChip} from "./ContextChip"
import {newBuilderSessionId} from "./newBuilderSession"
import {NewChatIntro} from "./NewChatIntro"
import {sessionToOpen} from "./openRule"
import {sentContextOf, withContextLine, type PageContext} from "./pageContext"
import {readPagePart, removedPagePartAtom} from "./pagePart"
import {QuickActions} from "./QuickActions"
import {RecentChats} from "./RecentChats"
import {SentContextChip} from "./SentContextChip"
import {builderChatLinkVersionAtom, useBuilderChatList} from "./useBuilderChatList"

/**
 * The chat the panel last showed, per user and project. A remount of the panel for the same agent
 * (a move between a session and an agent page) shows it again instead of running the open rule,
 * so a new chat with a draft is not lost (design D6). Another agent runs the rule.
 */
const lastShownChat = new Map<string, {agentId: string; builderSessionId: string}>()

/** A boolean, so a switch between two sessions renders nothing here (only the chip reads the id). */
const onSessionPageAtom = atom((get) => Boolean(get(pageSessionIdAtom)))

const sentContextChip = (message: UIMessage) => {
    const context = sentContextOf(message)
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
    const tPhone = useT(agentLayoutPhoneCatalog)
    const panel = useAgentPanel()
    // On a phone the builder covers the screen (M04 to M06): its back arrow returns to the page.
    const phone = panel.phone
    const onSessionPage = useAtomValue(onSessionPageAtom)
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
        (id: string) =>
            Boolean(liveness.data?.find((stream) => stream.session_id === id)?.flags?.is_running),
        [liveness.data],
    )

    // A removed chip belongs to the agent it was removed on: another agent starts with the chip.
    const setRemovedPagePart = useSetAtom(removedPagePartAtom)
    useEffect(() => setRemovedPagePart(null), [setRemovedPagePart])

    const show = useCallback((id: string) => {
        setBuilderSessionId(id)
        setView("chat")
    }, [])
    // The open rule, once the list answered (no stored chat answers at once). A failed list
    // opens a new chat; "Recent chats" then says it could not load.
    // A chat that still runs opens too: wait for liveness as well as the list.
    const ruleReady = builderSessionId === null && !recent.pending && !liveness.isLoading
    useEffect(() => {
        if (!ruleReady) return
        setBuilderSessionId(
            (!recent.failed && sessionToOpen(recent.rows, Date.now(), isRunning)) ||
                newBuilderSessionId(),
        )
    }, [ruleReady, recent.failed, recent.rows, isRunning])
    useEffect(() => {
        if (builderSessionId) lastShownChat.set(memoryKey, {agentId, builderSessionId})
    }, [builderSessionId, memoryKey, agentId])
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

    const header = useSessionHeader(projectId, isUnlinked ? "" : builderSessionId)
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
                composerHeaderExtra={
                    <ContextChip projectId={projectId} agentName={agentName} phone={phone} />
                }
                emptyState={<NewChatIntro agentName={agentName} phone={phone} />}
                // New chat group in the middle (S07), at the top on a phone (M04).
                newChatLayout={phone ? "top" : "middle"}
                belowComposer={
                    isUnlinked ? (
                        <div className="px-3 pt-3">
                            <QuickActions
                                sessionId={builderSessionId}
                                onPick={fillComposer}
                                phone={phone}
                            />
                        </div>
                    ) : null
                }
                newChatFooter={
                    isUnlinked ? (
                        <div className={phone ? "px-2 pt-2 pb-5" : "px-2 pt-3 pb-3.5"}>
                            <RecentChats
                                rows={recent.rows}
                                failed={recent.failed}
                                onRetry={recent.retry}
                                onOpen={show}
                                onViewAll={() => setView("history")}
                                phone={phone}
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
                isHistory={view === "history"}
                menuRows={recent.rows.slice(0, TITLE_MENU_CHATS)}
                onBack={() => setView("chat")}
                onOpenChat={show}
                onOpenHistory={() => setView("history")}
                onNewChat={() => show(newBuilderSessionId())}
                openInBuilderHref={
                    builderSessionId
                        ? builderChatHref({
                              workspaceId,
                              projectId,
                              sessionId: builderSessionId,
                              agentId,
                          })
                        : null
                }
                onClose={() => void panel.close()}
                phone={phone}
                backTitle={onSessionPage ? tPhone("agentLayout.phone.session") : undefined}
            />
            {view === "history" ? (
                <ChatHistory
                    userId={userId}
                    projectId={projectId}
                    agentId={agentId}
                    onOpen={show}
                    phone={phone}
                />
            ) : null}
            {/* The builder chat is the "embedded" conversation: its keys answer only while the
                focus is in it, never the session's own approval card. It stays mounted under the
                history, so its composer text and scroll position are there on the way back. */}
            <ConversationRoleContext.Provider value="embedded">
                <BuilderChatContext.Provider value>
                    <div className={view === "history" ? "hidden" : "min-h-0 flex-1"}>{body}</div>
                </BuilderChatContext.Provider>
            </ConversationRoleContext.Provider>
        </div>
    )
}
