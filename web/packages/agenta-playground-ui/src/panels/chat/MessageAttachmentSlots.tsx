import type {MessageContent} from "@agenta/shared/types"
import {getAttachments} from "@agenta/shared/utils"
import {MessageAttachments} from "@agenta/ui/chat-message"
import {
    PromptDocumentUpload,
    PromptImageUpload,
    type PromptUploadFile,
} from "@agenta/ui/components/presentational"

import type {UploadSlot} from "../../hooks/useTurnMessage"

export interface MessageAttachmentSlotsProps {
    /** The attachments the message has that no open slot shows. */
    listedAttachments: MessageContent
    uploadSlots: UploadSlot[]
    onRemoveListed: (index: number) => void
    onSetImage: (slotId: string, file: PromptUploadFile | null) => void
    onSetDocument: (slotId: string, fileData: string, filename: string, format: string) => void
    onRemoveSlot: (slotId: string) => void
}

/**
 * The attachments under a user message: the ones it already has, then one upload slot for each
 * image or document the user opened. A slot mounts only while it is open.
 */
export const MessageAttachmentSlots = ({
    listedAttachments,
    uploadSlots,
    onRemoveListed,
    onSetImage,
    onSetDocument,
    onRemoveSlot,
}: MessageAttachmentSlotsProps) => (
    <>
        {getAttachments(listedAttachments).length > 0 ? (
            <MessageAttachments content={listedAttachments} onRemove={onRemoveListed} />
        ) : null}
        {uploadSlots.map((slot) =>
            slot.type === "image" ? (
                <PromptImageUpload
                    key={slot.id}
                    imageFile={slot.file}
                    handleUploadFileChange={(file) => onSetImage(slot.id, file)}
                    handleRemoveUploadFile={() => onRemoveSlot(slot.id)}
                />
            ) : (
                <PromptDocumentUpload
                    key={slot.id}
                    value={slot.value}
                    onFileChange={(fileData, filename, format) =>
                        onSetDocument(slot.id, fileData, filename, format)
                    }
                    onRemove={() => onRemoveSlot(slot.id)}
                />
            ),
        )}
    </>
)
