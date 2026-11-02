import {useMemo, useState, type RefObject} from "react"

import {ApprovalCard} from "@agenta/chat/components"

import {getApiUrl} from "@/lib/env"

import {createEmbedClient} from "./embedClient"
import {EmbedComposer} from "./EmbedComposer"
import type {EmbedAppearance} from "./embedConfig"
import {EmbedConversationList} from "./EmbedConversationList"
import {EmbedGreeting} from "./EmbedGreeting"
import {EmbedHeader} from "./EmbedHeader"
import {EmbedTranscript} from "./EmbedTranscript"
import {EmbedLoading} from "./states/EmbedLoading"
import {EmbedNotice} from "./states/EmbedNotice"
import {EmbedUnavailable} from "./states/EmbedUnavailable"
import {useEmbedConversation} from "./useEmbedConversation"
import type {HostDetails} from "./useEmbedVisitor"

/** One visitor's chat: header, the open conversation or the list, approvals and the composer. */
export const EmbedChat = ({
    embedId,
    appearance,
    visitorKey,
    host,
}: {
    embedId: string
    appearance: EmbedAppearance
    visitorKey: string
    host: RefObject<HostDetails>
}) => {
    const client = useMemo(
        () => createEmbedClient({apiUrl: getApiUrl(), embedId, visitorKey}),
        [embedId, visitorKey],
    )
    const chat = useEmbedConversation({client, embedId, visitorKey, host})
    const [listOpen, setListOpen] = useState(false)

    if (chat.unavailable) return <EmbedUnavailable />

    const empty = chat.messages.length === 0
    const canStartNew = Boolean(chat.current) && !chat.switching
    const newChat = () => {
        chat.newChat()
        setListOpen(false)
    }
    let body
    if (listOpen) {
        body = (
            <EmbedConversationList
                conversations={chat.conversations}
                currentSessionId={chat.viewing?.session_id ?? null}
                canStartNew={canStartNew}
                onNewChat={newChat}
                onOpen={(conversation) => {
                    chat.reopen(conversation)
                    setListOpen(false)
                }}
            />
        )
    } else if (chat.loading) {
        body = <EmbedLoading />
    } else {
        body = (
            <EmbedTranscript
                key={chat.viewing?.session_id ?? "new"}
                messages={chat.messages}
                sessionId={chat.viewing?.session_id ?? embedId}
                running={chat.running}
                waitingForReply={chat.waitingForReply}
                waitingOnUser={chat.pendingApprovals.length > 0}
                fileBlob={chat.fileBlob}
                greeting={
                    empty ? (
                        <EmbedGreeting
                            appearance={appearance}
                            disabled={chat.switching}
                            onStarter={(text) => void chat.send(text, [])}
                        />
                    ) : null
                }
            />
        )
    }

    return (
        <>
            <EmbedHeader
                appearance={appearance}
                listOpen={listOpen}
                canStartNew={canStartNew}
                hasHistory={chat.conversations.length > 0}
                onToggleList={() => setListOpen((open) => !open)}
                onNewChat={newChat}
            />
            <div className="flex min-h-0 grow flex-col overflow-y-auto">{body}</div>
            {chat.pendingApprovals.length > 0 && !listOpen && !chat.switching ? (
                <div className="px-3 pb-2">
                    <ApprovalCard
                        approvals={chat.pendingApprovals}
                        responding={chat.approvalResponding}
                        answered={chat.approvalAnswered}
                        touch
                        onRespond={({approved}) => void chat.answerApproval(approved)}
                        onApproveAll={() => void chat.answerApproval(true)}
                        className="gap-2.5 rounded-md border border-solid border-border bg-background p-3"
                    />
                </div>
            ) : null}
            {chat.notice ? <EmbedNotice text={chat.notice} onDismiss={chat.dismissNotice} /> : null}
            {/* Hidden, not unmounted by the list, so a draft survives a look at the list. */}
            <div className={listOpen ? "hidden" : "contents"}>
                <EmbedComposer
                    disabled={chat.switching}
                    placeholder={`Message ${appearance.name}`}
                    onSend={chat.send}
                />
            </div>
        </>
    )
}
