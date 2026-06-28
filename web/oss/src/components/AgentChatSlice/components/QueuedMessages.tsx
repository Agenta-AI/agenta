import {memo, useState} from "react"

import {CaretDown, CaretUp, Paperclip, Stack, X} from "@phosphor-icons/react"
import {Popover, Typography} from "antd"

import type {QueuedMessage} from "../hooks/useAgentChatQueue"

const {Text} = Typography

/** Label for a text-less queued message (files only, or nothing). */
const fileLabel = (m: QueuedMessage): string => {
    const n = m.fileParts?.length ?? 0
    return n > 0 ? `${n} file${n > 1 ? "s" : ""}` : "(empty message)"
}

const QueuedList = ({
    queued,
    onRemove,
    onClear,
}: {
    queued: QueuedMessage[]
    onRemove: (id: string) => void
    onClear: () => void
}) => (
    <div className="w-[320px] max-w-[80vw]">
        <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2">
            <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                Queued — sent one by one
            </Text>
            <button
                type="button"
                onClick={onClear}
                className="cursor-pointer border-none bg-transparent !text-xs text-colorTextTertiary hover:text-colorText"
            >
                Clear all
            </button>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
            {queued.map((message, index) => {
                const text = message.text.trim()
                const fileCount = message.fileParts?.length ?? 0
                return (
                    <div key={message.id} className="flex items-start gap-2 px-3 py-1.5">
                        <span className="mt-px min-w-[14px] select-none text-[11px] leading-5 text-colorTextTertiary">
                            {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                            {/* Multi-line clamp + full text on hover — queued messages can be long. */}
                            <span
                                title={text || undefined}
                                className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-colorText"
                            >
                                {text || fileLabel(message)}
                            </span>
                            {text && fileCount > 0 && (
                                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-colorTextTertiary">
                                    <Paperclip size={11} />
                                    {fileCount} file{fileCount > 1 ? "s" : ""}
                                </span>
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
    onRemove,
    onClear,
}: {
    queued: QueuedMessage[]
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
            content={<QueuedList queued={queued} onRemove={onRemove} onClear={onClear} />}
        >
            <button
                type="button"
                aria-label={`${queued.length} queued message${queued.length > 1 ? "s" : ""}`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-solid border-colorBorder bg-colorBgContainer px-2.5 py-0.5 text-xs text-colorTextSecondary transition-colors hover:text-colorText"
            >
                <Stack size={13} />
                {queued.length} queued
                {open ? <CaretDown size={10} /> : <CaretUp size={10} />}
            </button>
        </Popover>
    )
}

export default memo(QueuedMessages)
