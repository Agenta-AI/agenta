import {useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {readValueMessage, type ValueMessage} from "@agenta/shared/utils"
import {AttachmentGrid, FileAttachment, ImageAttachment} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {ToolUIPart} from "ai"

import {ActivityTimeline} from "../components/activity/ActivityTimeline"
import ChatMarkdown from "../components/ChatMarkdown"
import {CollapsibleMessageBody} from "../components/CollapsibleMessageBody"
import ToolIOBlock from "../components/ToolIOBlock"
import type {ActivityStep} from "../model/activitySteps"

import {useValueViewOptions} from "./ValueViewProvider"

/** Over this many messages, the middle ones fold into "N more messages". */
export const MESSAGES_FOLD_OVER = 6
/** A long message is clamped at this height, with "Show more". */
const MESSAGE_MAX_PX = 200

/** The trace's work for one user exchange: its tool steps and the "Worked for" time. */
export interface TurnActivity {
    steps: ActivityStep[]
    durationMs?: number
}

export interface MessagesValueProps {
    /** One message object, or a list of them. */
    messages: unknown[]
    /** Keys the open state of each long message; unique per field on the screen. */
    stateKey: string
    /** Show every message, with no fold (the full view). */
    unfolded?: boolean
    /** One entry per user exchange, in order; matched to the exchanges from the end. */
    turnActivity?: readonly TurnActivity[]
}

interface MessageItem {
    index: number
    message: ValueMessage
    /** Tool messages that answer this message's calls, by call id. */
    results: Map<string, ValueMessage>
}

/** The activity block of a turn whose steps come from the trace. */
interface ItemActivity {
    key: string
    activity: TurnActivity
    /** "Turn N" before the line, when the chat has more than one turn. */
    leading?: string
}

/** One drawn entry: a message (with the trace's activity before it), or a lone activity block. */
type Entry =
    | {kind: "message"; item: MessageItem; activity?: ItemActivity; storedTools: boolean}
    | {kind: "activity"; activity: ItemActivity}

/** Stored tool calls as the settled steps `ActivityTimeline` draws. */
const toolSteps = (item: MessageItem): ActivityStep[] =>
    item.message.toolCalls.map((call, position) => {
        const id = call.id ?? `${item.index}-${position}`
        const result = call.id ? item.results.get(call.id) : undefined
        return {
            kind: "tool",
            key: id,
            files: [],
            part: {
                type: `tool-${call.name || "tool"}`,
                toolCallId: id,
                state: "output-available",
                input: call.arguments,
                output: result?.text,
            } as ToolUIPart,
        }
    })

/** Pair each tool result with the call it answers; a result with no call stays an item. */
function buildMessageItems(messages: unknown[]): MessageItem[] {
    const read = messages.map(readValueMessage)
    const calls = new Map<string, MessageItem>()
    const items: MessageItem[] = []
    read.forEach((message, index) => {
        const caller = message.toolCallId ? calls.get(message.toolCallId) : undefined
        if (message.role === "tool" && caller && message.toolCallId) {
            caller.results.set(message.toolCallId, message)
            return
        }
        const item: MessageItem = {index, message, results: new Map()}
        for (const call of message.toolCalls) if (call.id) calls.set(call.id, item)
        items.push(item)
    })
    return items
}

/**
 * One turn per user exchange: a user message and every message up to the next one. Messages
 * before the first user message (a system prompt) join the first turn, as spans before the first
 * turn do in `groupTraceTurns`. A chat with no user message is one turn.
 */
const splitTurns = (items: MessageItem[]): MessageItem[][] => {
    const turns: MessageItem[][] = []
    let hasUser = false
    for (const item of items) {
        const isUser = item.message.role === "user"
        if (turns.length === 0 || (isUser && hasUser)) turns.push([])
        hasUser ||= isUser
        turns[turns.length - 1].push(item)
    }
    return turns
}

/**
 * The drawn entries. A turn matched with a `turnActivity` entry (from the end) draws one activity
 * block before its last assistant message, in place of its stored tool calls.
 */
function buildEntries(
    items: MessageItem[],
    turnActivity: readonly TurnActivity[] | undefined,
    stateKey: string,
    turnLabel: (n: number) => string,
): Entry[] {
    if (!turnActivity?.length) {
        return items.map((item) => ({kind: "message", item, storedTools: true}))
    }
    const turns = splitTurns(items)
    return turns.flatMap((turn, position) => {
        const activity = turnActivity[turnActivity.length - turns.length + position]
        if (!activity) {
            return turn.map((item): Entry => ({kind: "message", item, storedTools: true}))
        }
        const block: ItemActivity = {
            key: `${stateKey}:turn:${position}`,
            activity,
            leading: turns.length > 1 ? turnLabel(position + 1) : undefined,
        }
        // The trace's steps replace the stored calls, so a message that held only calls goes.
        const kept = turn.filter(
            (item) =>
                item.message.role !== "tool" &&
                (item.message.toolCalls.length === 0 ||
                    Boolean(item.message.text) ||
                    item.message.attachments.length > 0),
        )
        let target = -1
        kept.forEach((item, index) => {
            if (item.message.role === "assistant") target = index
        })
        const entries = kept.map(
            (item, index): Entry => ({
                kind: "message",
                item,
                activity: index === target ? block : undefined,
                storedTools: false,
            }),
        )
        return target === -1 ? [...entries, {kind: "activity", activity: block}] : entries
    })
}
const Attachments = ({message}: {message: ValueMessage}) =>
    message.attachments.length === 0 ? null : (
        <AttachmentGrid>
            {message.attachments.map((part, index) =>
                part.type === "image_url" ? (
                    <ImageAttachment
                        key={index}
                        src={part.image_url.url}
                        alt={part.image_url.url}
                        size={96}
                        disabled
                    />
                ) : (
                    <FileAttachment
                        key={index}
                        filename={part.file.filename || part.file.name || part.file.file_id || ""}
                        disabled
                    />
                ),
            )}
        </AttachmentGrid>
    )

const MessageItemView = ({
    item,
    stateKey,
    activity,
    storedTools,
    unfolded,
}: {
    item: MessageItem
    stateKey: string
    activity?: ItemActivity
    storedTools: boolean
    /** The full view: long messages are not clamped. */
    unfolded: boolean
}) => {
    const t = useT(valueViewCatalog)
    const {markdownClassName, markdownIcons} = useValueViewOptions()
    const {message} = item
    const key = `${stateKey}:${item.index}`
    const clamp = (body: ReactNode): ReactNode =>
        unfolded ? (
            body
        ) : (
            <CollapsibleMessageBody stateKey={key} collapsedMaxPx={MESSAGE_MAX_PX}>
                {body}
            </CollapsibleMessageBody>
        )
    const markdown = (text: string): ReactNode =>
        clamp(
            <ChatMarkdown content={text} baseClassName={markdownClassName} icons={markdownIcons} />,
        )

    if (message.role === "user") {
        return (
            <div className="ml-auto flex max-w-[85%] flex-col gap-2 rounded-lg bg-secondary px-3 py-2 text-body">
                {message.text
                    ? clamp(<div className="whitespace-pre-wrap break-words">{message.text}</div>)
                    : null}
                <Attachments message={message} />
            </div>
        )
    }
    if (message.role === "tool") {
        return (
            <div className="flex min-w-0 flex-col gap-2">
                <ToolIOBlock
                    label={t("chat.valueView.resultOf", {
                        name: message.toolName ?? t("chat.valueView.toolResult"),
                    })}
                    value={message.text}
                />
                <Attachments message={message} />
            </div>
        )
    }
    return (
        <div className="flex min-w-0 flex-col gap-2">
            {message.role !== "assistant" ? (
                <span className="text-meta text-muted-foreground">{message.role}</span>
            ) : null}
            {activity ? <TraceActivity activity={activity} /> : null}
            {storedTools && message.toolCalls.length > 0 ? (
                <ActivityTimeline
                    messageId={key}
                    steps={toolSteps(item)}
                    streaming={false}
                    answerStarted
                />
            ) : null}
            {storedTools
                ? [...item.results.values()].map((result, index) => (
                      <Attachments key={index} message={result} />
                  ))
                : null}
            {message.text ? (
                message.role === "system" ? (
                    <div className="rounded-lg bg-muted px-3 py-2 text-body text-muted-foreground">
                        {markdown(message.text)}
                    </div>
                ) : (
                    markdown(message.text)
                )
            ) : null}
            <Attachments message={message} />
        </div>
    )
}

/** A turn's tool steps from the trace, with its "Worked for" time. */
const TraceActivity = ({activity: {key, activity, leading}}: {activity: ItemActivity}) => (
    <ActivityTimeline
        messageId={key}
        steps={activity.steps}
        streaming={false}
        answerStarted
        sessionTurnDurationMs={activity.durationMs}
        leading={leading}
    />
)

const EntryView = ({
    entry,
    stateKey,
    unfolded,
}: {
    entry: Entry
    stateKey: string
    unfolded: boolean
}) =>
    entry.kind === "activity" ? (
        <TraceActivity activity={entry.activity} />
    ) : (
        <MessageItemView
            item={entry.item}
            stateKey={stateKey}
            activity={entry.activity}
            storedTools={entry.storedTools}
            unfolded={unfolded}
        />
    )

const entryKey = (entry: Entry) =>
    entry.kind === "activity" ? entry.activity.key : String(entry.item.index)

/**
 * A chat as the playground draws it: the user message as a bubble, the agent reply as markdown,
 * tool calls folded under the activity line with their results, attachments as tiles. Long
 * messages clamp at 200 px; over six messages, the middle ones fold into "N more messages".
 * With `turnActivity`, each matched turn draws the trace's steps in place of its stored calls.
 */
export const MessagesValue = ({
    messages,
    stateKey,
    unfolded = false,
    turnActivity,
}: MessagesValueProps) => {
    const t = useT(valueViewCatalog)
    const entries = useMemo(
        () =>
            buildEntries(buildMessageItems(messages), turnActivity, stateKey, (n) =>
                t("chat.valueView.turnLabel", {n}),
            ),
        [messages, turnActivity, stateKey, t],
    )
    const [showAll, setShowAll] = useState(false)
    const folded = !unfolded && !showAll && entries.length > MESSAGES_FOLD_OVER
    const head = folded ? entries.slice(0, 2) : entries
    const tail = folded ? entries.slice(-2) : []
    const hidden = entries.length - head.length - tail.length

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {head.map((entry) => (
                <EntryView
                    key={entryKey(entry)}
                    entry={entry}
                    stateKey={stateKey}
                    unfolded={unfolded}
                />
            ))}
            {folded ? (
                <div className="flex items-center gap-2">
                    <span aria-hidden className="h-px flex-1 bg-border-muted" />
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setShowAll(true)}
                    >
                        {t("chat.valueView.moreMessages", {count: hidden})}
                    </Button>
                    <span aria-hidden className="h-px flex-1 bg-border-muted" />
                </div>
            ) : null}
            {tail.map((entry) => (
                <EntryView
                    key={entryKey(entry)}
                    entry={entry}
                    stateKey={stateKey}
                    unfolded={unfolded}
                />
            ))}
        </div>
    )
}
