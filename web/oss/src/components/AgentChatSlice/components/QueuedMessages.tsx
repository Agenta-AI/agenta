import {memo} from "react"

import {Paperclip, X} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"

import type {QueuedMessage} from "../hooks/useAgentChatQueue"

const {Text} = Typography

/** Short label for a queued message: its text, or an attachment count when text-less. */
const preview = (m: QueuedMessage): string => {
    const text = m.text.trim()
    if (text) return text
    const n = m.fileParts?.length ?? 0
    return n > 0 ? `${n} file${n > 1 ? "s" : ""}` : "(empty)"
}

/**
 * Pending user messages typed while the agent was streaming. They're sent one-by-one after the
 * current turn settles (see `useAgentChatQueue`); each can be removed before it goes out.
 */
const QueuedMessages = ({
    queued,
    onRemove,
}: {
    queued: QueuedMessage[]
    onRemove: (id: string) => void
}) => {
    if (queued.length === 0) return null
    return (
        <div className="flex flex-col gap-1">
            <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                Queued ({queued.length}) — sent one by one after the reply
            </Text>
            <div className="flex flex-wrap gap-1">
                {queued.map((m) => (
                    <Tag
                        key={m.id}
                        closable
                        onClose={(e) => {
                            e.preventDefault()
                            onRemove(m.id)
                        }}
                        closeIcon={<X size={10} />}
                        className="!m-0 flex max-w-[240px] items-center gap-1 !text-[11px]"
                    >
                        {!m.text.trim() && (m.fileParts?.length ?? 0) > 0 && (
                            <Paperclip size={10} className="shrink-0" />
                        )}
                        <span className="truncate">{preview(m)}</span>
                    </Tag>
                ))}
            </div>
        </div>
    )
}

export default memo(QueuedMessages)
