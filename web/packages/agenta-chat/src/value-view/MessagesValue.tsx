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
/** A long turn is clamped at this height, with "Show more". */
const TURN_MAX_PX = 200

export interface MessagesValueProps {
    /** One message object, or a list of them. */
    messages: unknown[]
    /** Keys the open state of each long turn; unique per field on the screen. */
    stateKey: string
    /** Show every message, with no fold (the full view). */
    unfolded?: boolean
}

interface Turn {
    index: number
    message: ValueMessage
    /** Tool messages that answer this message's calls, by call id. */
    results: Map<string, ValueMessage>
}

/** Stored tool calls as the settled steps `ActivityTimeline` draws. */
const toolSteps = (turn: Turn): ActivityStep[] =>
    turn.message.toolCalls.map((call, position) => {
        const id = call.id ?? `${turn.index}-${position}`
        const result = call.id ? turn.results.get(call.id) : undefined
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

/** Pair each tool result with the call it answers; a result with no call stays a turn. */
function buildTurns(messages: unknown[]): Turn[] {
    const read = messages.map(readValueMessage)
    const calls = new Map<string, Turn>()
    const turns: Turn[] = []
    read.forEach((message, index) => {
        const caller = message.toolCallId ? calls.get(message.toolCallId) : undefined
        if (message.role === "tool" && caller && message.toolCallId) {
            caller.results.set(message.toolCallId, message)
            return
        }
        const turn: Turn = {index, message, results: new Map()}
        for (const call of message.toolCalls) if (call.id) calls.set(call.id, turn)
        turns.push(turn)
    })
    return turns
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

const TurnView = ({
    turn,
    stateKey,
    unfolded,
}: {
    turn: Turn
    stateKey: string
    /** The full view: long turns are not clamped. */
    unfolded: boolean
}) => {
    const t = useT(valueViewCatalog)
    const {markdownClassName, markdownIcons} = useValueViewOptions()
    const {message} = turn
    const key = `${stateKey}:${turn.index}`
    const clamp = (body: ReactNode): ReactNode =>
        unfolded ? (
            body
        ) : (
            <CollapsibleMessageBody stateKey={key} collapsedMaxPx={TURN_MAX_PX}>
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
            {message.toolCalls.length > 0 ? (
                <ActivityTimeline
                    messageId={key}
                    steps={toolSteps(turn)}
                    streaming={false}
                    answerStarted
                />
            ) : null}
            {[...turn.results.values()].map((result, index) => (
                <Attachments key={index} message={result} />
            ))}
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

/**
 * A chat as the playground draws it: the user turn as a bubble, the agent reply as markdown,
 * tool calls folded under the activity line with their results, attachments as tiles. Long
 * turns clamp at 200 px; over six messages, the middle ones fold into "N more messages".
 */
export const MessagesValue = ({messages, stateKey, unfolded = false}: MessagesValueProps) => {
    const t = useT(valueViewCatalog)
    const turns = useMemo(() => buildTurns(messages), [messages])
    const [showAll, setShowAll] = useState(false)
    const folded = !unfolded && !showAll && turns.length > MESSAGES_FOLD_OVER
    const head = folded ? turns.slice(0, 2) : turns
    const tail = folded ? turns.slice(-2) : []
    const hidden = turns.length - head.length - tail.length

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {head.map((turn) => (
                <TurnView key={turn.index} turn={turn} stateKey={stateKey} unfolded={unfolded} />
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
            {tail.map((turn) => (
                <TurnView key={turn.index} turn={turn} stateKey={stateKey} unfolded={unfolded} />
            ))}
        </div>
    )
}
