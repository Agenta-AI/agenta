/**
 * MessageAttachments Component
 *
 * Display and manage attachments for a single message.
 * Shows image previews and file badges with remove buttons.
 * Built on top of the presentational attachment components.
 */

import React from "react"

import type {MessageContent} from "@agenta/shared/types"
import {getAttachments} from "@agenta/shared/utils"

import {
    AttachmentGrid,
    ImageAttachment,
    FileAttachment,
} from "../../components/presentational/attachments"

interface MessageAttachmentsProps {
    content: MessageContent
    onRemove: (index: number) => void
    disabled?: boolean
    /** Optional image preview component - if not provided, uses simple img tag */
    ImagePreview?: React.ComponentType<{
        src: string
        alt: string
        size: number
        isValidPreview: boolean
    }>
}

/**
 * Display and manage attachments for a single message.
 * Shows image previews and file badges with remove buttons.
 */
export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({
    content,
    onRemove,
    disabled,
    ImagePreview,
}) => {
    const attachments = getAttachments(content)
    if (attachments.length === 0) return null

    return (
        <AttachmentGrid>
            {attachments.map((attachment, index) => {
                if (attachment.type === "image_url") {
                    const url = attachment.image_url.url
                    return (
                        <ImageAttachment
                            key={`img-${index}`}
                            src={url}
                            alt={`Attachment ${index + 1}`}
                            onRemove={() => onRemove(index)}
                            disabled={disabled}
                            ImagePreview={ImagePreview}
                        />
                    )
                }
                if (attachment.type === "file") {
                    const filename = attachment.file.filename || attachment.file.name || "Document"
                    return (
                        <FileAttachment
                            key={`file-${index}`}
                            filename={filename}
                            onRemove={() => onRemove(index)}
                            disabled={disabled}
                        />
                    )
                }
                return null
            })}
        </AttachmentGrid>
    )
}

export default MessageAttachments
