import {memo, useMemo} from "react"

import {ActivityTimeline} from "@agenta/chat/components"
import {useTypewriter} from "@agenta/chat/hooks"
import ChatMarkdown from "@agenta/chat/markdown"
import {endsOnClosedText, splitTurnActivity, type TurnViewModel} from "@agenta/chat/model"
import {ChatBubble, userBubbleContentClass} from "@agenta/ui/components/presentational"

import {cn} from "@/lib/utils"

import {markdownIcons, proseClassName} from "../chat/AssistantMarkdown"
import {isLiveTextItem} from "../chat/markdownStream"
import {mobileTurnRowClass} from "../chat/turnRowClass"

import {REPLY_FAILED_TEXT} from "./embedConversationModel"
import {EmbedFile} from "./EmbedFile"

const Answer = ({text, streaming}: {text: string; streaming: boolean}) => {
    const {text: revealed, settled} = useTypewriter(text)
    return (
        <ChatMarkdown
            baseClassName={proseClassName}
            content={revealed}
            streaming={streaming || !settled}
            icons={markdownIcons}
        />
    )
}

/** One transcript turn, as the app shows it, without the owner-only trace and retry actions. */
const EmbedTurnInner = ({
    turn,
    sessionId,
    live,
    waitingOnUser,
    fileBlob,
}: {
    turn: TurnViewModel
    sessionId: string
    live: boolean
    waitingOnUser: boolean
    fileBlob: (fileId: string) => Promise<Blob>
}) => {
    const trailingClosed = useMemo(() => endsOnClosedText(turn.items), [turn.items])
    const activity = useMemo(
        () => splitTurnActivity(turn.items, {holdClosedText: live && trailingClosed}),
        [turn.items, live, trailingClosed],
    )
    const files = turn.items.flatMap((item) => (item.kind === "files" ? item.parts : []))
    const fileList = files.length ? (
        <div className={cn("flex flex-wrap gap-2", turn.isUser && "justify-end")}>
            {files.map((file, index) => (
                <EmbedFile
                    key={`${file.url}-${index}`}
                    url={file.url}
                    name={file.filename || "attachment"}
                    mediaType={file.mediaType ?? ""}
                    fileBlob={fileBlob}
                />
            ))}
        </div>
    ) : null

    if (turn.hidden) return null

    if (turn.isUser) {
        const texts = turn.items.flatMap((item) =>
            item.kind === "part" && item.part.type === "text" && item.part.text.trim()
                ? [item.part.text]
                : [],
        )
        return (
            <div className={`${mobileTurnRowClass} justify-end`}>
                <ChatBubble
                    placement="end"
                    variant={texts.length ? "filled" : "borderless"}
                    className="min-w-0 max-w-[85%]"
                    classNames={{
                        content: cn(userBubbleContentClass, "rounded-md text-xs"),
                        body: "min-w-0 max-w-full overflow-hidden",
                    }}
                    header={fileList}
                    content={
                        texts.length ? (
                            <div className="flex min-w-0 flex-col gap-2">
                                {texts.map((text, index) => (
                                    <ChatMarkdown
                                        key={index}
                                        baseClassName={proseClassName}
                                        content={text}
                                        streaming={false}
                                    />
                                ))}
                            </div>
                        ) : null
                    }
                />
            </div>
        )
    }

    // Visitors get fixed text: the run's own error is internal.
    const errorText = turn.status.showError ? REPLY_FAILED_TEXT : null
    return (
        <div className={`${mobileTurnRowClass} justify-start`}>
            <ChatBubble
                placement="start"
                variant="borderless"
                className="min-w-0 max-w-full"
                classNames={{
                    content: "min-w-0 max-w-full overflow-hidden text-xs",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                header={fileList}
                content={
                    <div className="flex min-w-0 max-w-full flex-col gap-3">
                        <ActivityTimeline
                            messageId={turn.message.id}
                            sessionId={sessionId}
                            steps={activity.steps}
                            streaming={live}
                            answerStarted={activity.answer !== null}
                            waitingOnUser={turn.isLast && waitingOnUser}
                        />
                        {activity.answer ? (
                            <Answer
                                text={activity.answer.text}
                                streaming={isLiveTextItem(turn, activity.answerIndex)}
                            />
                        ) : null}
                        {errorText ? (
                            <p role="alert" className="m-0 text-xs text-destructive">
                                {errorText}
                            </p>
                        ) : null}
                    </div>
                }
            />
        </div>
    )
}

export const EmbedTurn = memo(EmbedTurnInner)
