import {useCallback, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Robot, X} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {useSetAtom, useStore} from "jotai"

import {cn} from "@/lib/utils"

import {rememberBuilderChat} from "../builder/builderChatLink"
import {chipClass} from "../builder/chipText"
import {sentContextOf, withContextLine, type PageContext} from "../builder/pageContext"
import {SentContextChip} from "../builder/SentContextChip"
import {builderChatLinkVersionAtom} from "../builder/useBuilderChatList"
import {BuilderChatContext} from "../chat/builderChat"
import {ConversationRoleContext} from "../chat/conversationRole"
import {LiveConversation} from "../chat/LiveConversation"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useLivenessPoll} from "../sessions/useLivenessPoll"

import {BrowseIdeasDialog} from "./BrowseIdeasDialog"
import type {HeroState} from "./hero/BuilderHero"
import {NewBuilderChat} from "./NewBuilderChat"
import {PageQuickActions} from "./PageQuickActions"
import type {AgentRef} from "./paneAgent"

const sentContextChip = (message: UIMessage) => {
    const context = sentContextOf(message)
    return context ? <SentContextChip context={context} /> : null
}

/**
 * The conversation of one builder chat on the builder page. A new chat shows the hero, the
 * quick actions and "Browse ideas" (B01, B02). Every message carries the agent of the chip as
 * page context (design D13): the agent picked with "Improve an agent", else the agent of the
 * pane. A removed chip sends no agent.
 */
export const BuilderPageChat = ({
    builderRevisionId,
    sessionId,
    isNew,
    userId,
    workspaceId,
    projectId,
    paneAgent,
    activeTabKey,
    onFirstSend,
    onMessagesChanged,
    dialogContainer,
}: {
    builderRevisionId: string
    sessionId: string
    /** A new chat, not one opened from the address: a chat that loads its messages is not new. */
    isNew: boolean
    userId: string
    workspaceId: string
    projectId: string
    /** The agent of the pane, the default context of a message. */
    paneAgent: AgentRef | null
    /** The key of the active builder tab: a change resets the chip to follow it. */
    activeTabKey: string | null
    /** The first message of a new chat left the composer. */
    onFirstSend: (agent: AgentRef | null) => void
    onMessagesChanged: (messages: UIMessage[]) => void
    /** Where "Browse ideas" opens: the page beside the sidebar (B02). */
    dialogContainer: HTMLElement | null
}) => {
    const t = useT(builderPageCatalog, builderContextCatalog)
    const store = useStore()
    const bumpLinkVersion = useSetAtom(builderChatLinkVersionAtom)
    const liveness = useLivenessPoll(projectId)
    const liveStream = liveness.data?.find((stream) => stream.session_id === sessionId)

    const [hasMessages, setHasMessages] = useState(false)
    const [pickedAgent, setPickedAgent] = useState<AgentRef | null>(null)
    const [chipRemoved, setChipRemoved] = useState(false)
    const [ideasOpen, setIdeasOpen] = useState(false)
    const [heroState, setHeroState] = useState<HeroState>("idle")
    const chipAgent = chipRemoved ? null : (pickedAgent ?? paneAgent)
    // Another active tab: the chip follows it, and an earlier pick or removal no longer holds
    // (reset while rendering, so the old chip never shows).
    const [chipTabKey, setChipTabKey] = useState(activeTabKey)
    if (chipTabKey !== activeTabKey) {
        setChipTabKey(activeTabKey)
        setPickedAgent(null)
        setChipRemoved(false)
    }

    const handleMessages = useCallback(
        (messages: UIMessage[]) => {
            setHasMessages(messages.length > 0)
            onMessagesChanged(messages)
        },
        [onMessagesChanged],
    )

    const hasMessagesRef = useRef(hasMessages)
    hasMessagesRef.current = hasMessages
    const beforeSend = useCallback(
        (text: string) => {
            if (!hasMessagesRef.current) onFirstSend(chipAgent)
            if (!chipAgent) return text
            if (rememberBuilderChat(userId, projectId, chipAgent.id, sessionId))
                bumpLinkVersion((version) => version + 1)
            const context: PageContext = {
                agent: {id: chipAgent.id, name: chipAgent.name},
                has_unsaved_draft: store.get(viewFormDirtyAtom),
            }
            return withContextLine(context, text)
        },
        [bumpLinkVersion, chipAgent, onFirstSend, projectId, sessionId, store, userId],
    )

    // A ready request or an idea replaces the composer text and is not sent.
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const fillComposer = useCallback((text: string) => {
        const input = inputRef.current
        if (!input) return
        void input.setMarkdown(text).then(() => {
            input.focus()
            setHeroState(text.trim() ? "typing" : "idle")
        })
    }, [])
    // The hero follows the composer: empty is "idle", text is "typing".
    const onComposerInput = () => {
        const text = inputRef.current?.getMarkdown() ?? ""
        setHeroState(text.trim() ? "typing" : "idle")
    }

    const chip = chipAgent ? (
        <span
            data-testid="builder-page-context-chip"
            className={cn(chipClass, "self-start pr-1")}
            title={`${t("builder.context.title")}: ${chipAgent.name}`}
        >
            <Robot aria-hidden size={12} className="shrink-0" />
            <span className="truncate">{chipAgent.name}</span>
            <button
                type="button"
                aria-label={t("builder.context.remove")}
                title={t("builder.context.remove")}
                onClick={() => {
                    setPickedAgent(null)
                    setChipRemoved(true)
                }}
                className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:bg-colorFillSecondary hover:text-colorText"
            >
                <X aria-hidden size={12} />
            </button>
        </span>
    ) : null

    return (
        <ConversationRoleContext.Provider value="page">
            <BuilderChatContext.Provider value>
                <div className="flex h-full min-h-0 flex-col" onInputCapture={onComposerInput}>
                    <LiveConversation
                        key={sessionId}
                        embedded
                        entityId={builderRevisionId}
                        sessionId={sessionId}
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
                        composerPlaceholder={
                            isNew && !hasMessages
                                ? t("builder.page.placeholderNew")
                                : t("builder.page.placeholder")
                        }
                        composerHeaderExtra={chip}
                        emptyState={<NewBuilderChat heroState={heroState} />}
                        // Above the composer (B01), only in a new chat once it has loaded.
                        aboveComposer={
                            isNew ? (
                                <div className="px-3 pb-2.5">
                                    <PageQuickActions
                                        onFill={fillComposer}
                                        onPickAgent={(agent) => {
                                            setPickedAgent(agent)
                                            setChipRemoved(false)
                                        }}
                                        onBrowseIdeas={() => setIdeasOpen(true)}
                                    />
                                </div>
                            ) : null
                        }
                        userMessageAccessory={sentContextChip}
                        onMessagesChanged={handleMessages}
                    />
                    <BrowseIdeasDialog
                        container={dialogContainer}
                        open={ideasOpen}
                        onOpenChange={setIdeasOpen}
                        onPick={(prompt) => {
                            setIdeasOpen(false)
                            fillComposer(prompt)
                        }}
                    />
                </div>
            </BuilderChatContext.Provider>
        </ConversationRoleContext.Provider>
    )
}
