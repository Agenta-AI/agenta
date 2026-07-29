import {memo, useState} from "react"

import {
    CaretDown,
    CaretUp,
    File as FileIcon,
    SpeakerHigh,
    Stack,
    VideoCamera,
    X,
} from "@phosphor-icons/react"
import type {FileUIPart} from "ai"
import {Popover, Typography} from "antd"

import {fileKind, filePartName} from "../assets/files"
import type {QueuedMessage} from "../hooks/useAgentChatQueue"

const {Text} = Typography

/** One attachment tile: image thumbnail, else a type icon. */
const Attachment = ({part}: {part: FileUIPart}) => {
    const name = filePartName(part)
    const kind = fileKind(part.mediaType)
    if (kind === "image") {
        return (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL thumbnail, no optimization
            <img
                src={part.url}
                alt={name}
                title={name}
                className="h-6 w-6 shrink-0 rounded border border-solid border-colorBorderSecondary object-cover"
            />
        )
    }
    const Icon = kind === "audio" ? SpeakerHigh : kind === "video" ? VideoCamera : FileIcon
    return (
        <span
            role="img"
            aria-label={name}
            title={name}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-solid border-colorBorderSecondary bg-colorFillTertiary text-colorTextSecondary"
        >
            <Icon size={12} aria-hidden />
        </span>
    )
}

const QueuedList = ({
    queued,
    held,
    onRemove,
    onClear,
}: {
    queued: QueuedMessage[]
    held: boolean
    onRemove: (id: string) => void
    onClear: () => void
}) => (
    <div className="w-[300px] max-w-[80vw]">
        <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-colorBorderSecondary px-2.5 py-1.5">
            <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                {held ? "Held until you answer the agent" : "Queued — sent one by one"}
            </Text>
            <button
                type="button"
                onClick={onClear}
                className="cursor-pointer border-none bg-transparent !text-[11px] text-colorTextTertiary hover:text-colorText"
            >
                Clear all
            </button>
        </div>
        <div className="max-h-64 overflow-y-auto py-0.5">
            {queued.map((message, index) => {
                const text = message.text.trim()
                const files = message.fileParts ?? []
                return (
                    <div key={message.id} className="flex items-start gap-1.5 px-2.5 py-1">
                        <span className="mt-px min-w-[12px] select-none text-[11px] leading-5 text-colorTextTertiary">
                            {index + 1}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {text ? (
                                // Clamp to 2 lines; full text on hover.
                                <span
                                    title={text}
                                    className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-colorText"
                                >
                                    {text}
                                </span>
                            ) : files.length === 0 ? (
                                <span className="text-xs italic leading-5 text-colorTextTertiary">
                                    (empty message)
                                </span>
                            ) : null}
                            {files.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                    {files.map((part, i) => (
                                        <Attachment key={`${message.id}-${i}`} part={part} />
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label="Remove queued message"
                            onClick={() => onRemove(message.id)}
                            className="mt-px shrink-0 cursor-pointer border-none bg-transparent p-0 leading-none text-colorTextTertiary hover:text-colorText"
                        >
                            <X size={12} />
                        </button>
                    </div>
                )
            })}
        </div>
    </div>
)

/**
 * Collapsed queue control: a count pill in the composer footer that opens a popover to read,
 * reorder-by-removal, and clear messages typed while a turn was streaming. Fixed footprint —
 * the composer height never grows with the queue.
 */
const QueuedMessages = ({
    queued,
    held = false,
    onRemove,
    onClear,
}: {
    queued: QueuedMessage[]
    /** The run is paused on the user (HITL / parked interaction) — say WHY the queue is held. */
    held?: boolean
    onRemove: (id: string) => void
    onClear: () => void
}) => {
    const [open, setOpen] = useState(false)
    if (queued.length === 0) return null
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topLeft"
            arrow={false}
            styles={{content: {padding: 0}}}
            content={
                <QueuedList queued={queued} held={held} onRemove={onRemove} onClear={onClear} />
            }
        >
            <button
                type="button"
                aria-label={`${queued.length} queued message${queued.length > 1 ? "s" : ""}${
                    held ? ", held until you respond to the agent" : ""
                }`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-solid border-colorBorder bg-colorBgContainer px-2.5 py-0.5 text-xs text-colorTextSecondary transition-colors hover:text-colorText"
            >
                <Stack size={13} />
                {queued.length} queued
                {held ? <span className="text-colorTextTertiary">· waiting on you</span> : null}
                {open ? <CaretDown size={10} /> : <CaretUp size={10} />}
            </button>
        </Popover>
    )
}

export default memo(QueuedMessages)
