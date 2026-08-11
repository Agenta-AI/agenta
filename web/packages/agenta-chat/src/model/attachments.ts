/** A file staged for upload before it's sent — neutral shape, independent of the desktop
 * upload-item type. `uid` mirrors the desktop composer's dedup key so callers can migrate
 * without changing behavior. */
export interface PendingAttachment {
    file: File
    uid: string
    name: string
}

// uid formula mirrored from `toUploadFile` in
// web/oss/src/components/AgentChatSlice/AgentConversation.tsx (2026-07-25); the desktop
// composer keeps its own upload-item type, so only the dedup key is shared here.
export const toPendingAttachment = (file: File): PendingAttachment => ({
    file,
    uid: `${file.name}-${file.lastModified}-${file.size}`,
    name: file.name,
})
