import {useCallback, useEffect, useRef, useState} from "react"

import {AttachmentCard, AttachmentCardGrid} from "@agenta/chat/components"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Paperclip} from "@phosphor-icons/react"

import {isAgentFileUploadsEnabled} from "@/oss/components/AgentChatSlice/assets/constants"

/**
 * Attach files from a composer that has no session yet (Home, an agent's overview).
 *
 * Uploads are session-scoped, and these composers create the session by navigating. So nothing is
 * uploaded here and no validation is repeated: the picked `File`s ride the first-run seed and go
 * through the chat's own `addFiles` on arrival, which is the same path paste and drop use — that
 * is where limits, rejections, the tray and the upload lifecycle already live.
 */
export const useSeedAttachments = () => {
    const [files, setFiles] = useState<File[]>([])
    const clear = useCallback(() => setFiles([]), [])
    return {files, setFiles, clear, enabled: isAgentFileUploadsEnabled()}
}

export const SeedAttachButton = ({
    files,
    onChange,
    disabled,
}: {
    files: File[]
    onChange: (files: File[]) => void
    disabled?: boolean
}) => {
    const inputRef = useRef<HTMLInputElement>(null)

    return (
        <>
            <SimpleTooltip title="Attach files">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Attach files"
                    disabled={disabled}
                    onClick={() => inputRef.current?.click()}
                >
                    <Paperclip size={16} />
                </Button>
            </SimpleTooltip>
            <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                    const picked = Array.from(event.target.files ?? [])
                    if (picked.length) onChange([...files, ...picked])
                    // Reset so picking the same file twice still fires a change.
                    event.target.value = ""
                }}
            />
        </>
    )
}

/**
 * The same cards the chat tray draws, so a seeded composer does not look like a different product.
 * No upload state: nothing is uploaded until the session exists — these files ride the first-run
 * seed and go through the chat's own `addFiles` on arrival.
 */
export const SeedAttachmentChips = ({
    files,
    onChange,
}: {
    files: File[]
    onChange: (files: File[]) => void
}) => {
    // Keyed by the File itself, not by position: `previews` is state and lags `files` by a commit,
    // so an index lookup hands a surviving card the URL of the one just removed — a URL this
    // effect is revoking in the same pass.
    const [previews, setPreviews] = useState<Map<File, string>>(new Map())

    useEffect(() => {
        const urls = new Map<File, string>()
        files.forEach((file) => {
            if (file.type.startsWith("image/") || file.type.startsWith("audio/")) {
                urls.set(file, URL.createObjectURL(file))
            }
        })
        setPreviews(urls)
        return () => urls.forEach((url) => URL.revokeObjectURL(url))
    }, [files])

    if (!files.length) return null
    return (
        <div className="px-3 pt-2">
            <AttachmentCardGrid>
                {files.map((file, index) => (
                    <AttachmentCard
                        key={`${file.name}-${index}`}
                        name={file.name}
                        mediaType={file.type}
                        src={previews.get(file)}
                        action="remove"
                        onRemove={() => onChange(files.filter((_, at) => at !== index))}
                    />
                ))}
            </AttachmentCardGrid>
        </div>
    )
}
