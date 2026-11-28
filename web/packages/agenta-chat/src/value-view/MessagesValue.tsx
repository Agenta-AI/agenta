import {useId, useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatActivityCatalog from "@agenta/i18n/catalogs/chat.activity"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {readValueMessage, type ValueMessage} from "@agenta/shared/utils"
import {AttachmentGrid, FileAttachment, ImageAttachment} from "@agenta/ui/components/presentational"
import {Button, CollapseCaret} from "@agenta/ui/ui"
import type {ToolUIPart} from "ai"

import {ActivityTimeline} from "../components/activity/ActivityTimeline"
import ChatMarkdown from "../components/ChatMarkdown"
import {CollapsibleMessageBody} from "../components/CollapsibleMessageBody"
import ToolIOBlock from "../components/ToolIOBlock"
import {formatElapsed} from "../hooks/useTurnClock"
import type {ActivityStep} from "../model/activitySteps"

import {formatTextSize} from "./FieldFold"
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
export interface ItemActivity {
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
 * block before its last assistant message, in place of its stored tool calls. An entry with no
 * steps keeps the stored calls and adds only its time and label.
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
        // A turn with no step in the trace keeps its stored calls; the entry gives only its time,
        // on the line of the last assistant message that made calls, else before the last reply.
        const traceSteps = activity.steps.length > 0
        // The trace's steps replace the stored calls, so a message that held only calls goes.
        const kept = traceSteps
            ? turn.filter(
                  (item) =>
                      item.message.role !== "tool" &&
                      (item.message.toolCalls.length === 0 ||
                          Boolean(item.message.text) ||
                          item.message.attachments.length > 0),
              )
            : turn
        const isAssistant = (item: MessageItem) => item.message.role === "assistant"
        const caller = traceSteps
            ? -1
            : kept.findLastIndex((item) => isAssistant(item) && item.message.toolCalls.length > 0)
        const target = caller !== -1 ? caller : kept.findLastIndex(isAssistant)
        const entries = kept.map(
            (item, index): Entry => ({
                kind: "message",
                item,
                activity: index === target ? block : undefined,
                storedTools: !traceSteps,
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

/** A system message folded to one line, "System prompt · SIZE", that opens on click. */
const SystemMessageFold = ({
    text,
    defaultOpen,
    children,
}: {
    text: string
    defaultOpen: boolean
    children: ReactNode
}) => {
    const t = useT(valueViewCatalog)
    const [open, setOpen] = useState(defaultOpen)
    const regionId = useId()
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={open}
                aria-controls={regionId}
                className="h-auto min-w-0 self-start gap-1.5 px-0 text-meta text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent"
                onClick={() => setOpen((next) => !next)}
            >
                <CollapseCaret open={open} />
                <span className="min-w-0 truncate">
                    {`${t("chat.valueView.systemPrompt")} · ${formatTextSize(t, text)}`}
                </span>
            </Button>
            {open ? (
                <div
                    id={regionId}
                    className="rounded-lg bg-muted px-3 py-2 text-body text-muted-foreground"
                >
                    {children}
                </div>
            ) : null}
        </div>
    )
}

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
    /** The full view: long messages are not clamped, the system prompt is open. */
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
            {message.role !== "assistant" && !(message.role === "system" && message.text) ? (
                <span className="text-meta text-muted-foreground">{message.role}</span>
            ) : null}
            {storedTools && message.toolCalls.length > 0 ? (
                // A turn whose trace had no step: its time and label join the stored calls' line.
                <ActivityTimeline
                    messageId={key}
                    steps={toolSteps(item)}
                    streaming={false}
                    answerStarted
                    sessionTurnDurationMs={activity?.activity.durationMs}
                    leading={activity?.leading}
                    trailing={t("chat.valueView.toolCalls", {count: message.toolCalls.length})}
                />
            ) : activity ? (
                <TraceActivity activity={activity} />
            ) : null}
            {storedTools
                ? [...item.results.values()].map((result, index) => (
                      <Attachments key={index} message={result} />
                  ))
                : null}
            {message.text ? (
                message.role === "system" ? (
                    <SystemMessageFold text={message.text} defaultOpen={unfolded}>
                        {markdown(message.text)}
                    </SystemMessageFold>
                ) : (
                    markdown(message.text)
                )
            ) : null}
            <Attachments message={message} />
        </div>
    )
}

/** A turn with a time and no step: the settled "Worked for X" line, with nothing to open. */
const WorkedForLine = ({durationMs, leading}: {durationMs: number; leading?: string}) => {
    const t = useT(chatActivityCatalog)
    return (
        <div className="flex min-w-0 items-center gap-1.5 py-1.5 text-label text-muted-foreground">
            {leading ? (
                <>
                    <span className="shrink-0">{leading}</span>
                    <span aria-hidden className="shrink-0">
                        ·
                    </span>
                </>
            ) : null}
            <span className="min-w-0 truncate">
                {t("chat.activity.workedFor", {time: formatElapsed(durationMs, {live: false})})}
            </span>
        </div>
    )
}

/**
 * A turn's tool steps from the trace, with its "Worked for" time and its tool call count. With no
 * step, only the "Worked for" line; with no step and no time, nothing.
 */
export const TraceActivity = ({activity: {key, activity, leading}}: {activity: ItemActivity}) => {
    const t = useT(valueViewCatalog)
    // Server and client tools both count; a thought is not a call.
    const calls = activity.steps.filter((step) => step.kind !== "thought").length
    if (activity.steps.length === 0) {
        return activity.durationMs === undefined ? null : (
            <WorkedForLine durationMs={activity.durationMs} leading={leading} />
        )
    }
    return (
        <ActivityTimeline
            messageId={key}
            steps={activity.steps}
            streaming={false}
            answerStarted
            sessionTurnDurationMs={activity.durationMs}
            leading={leading}
            trailing={calls ? t("chat.valueView.toolCalls", {count: calls}) : undefined}
        />
    )
}

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
