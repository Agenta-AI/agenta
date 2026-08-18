import {useCallback, useRef, useState} from "react"

import {Paperclip, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

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
            <Tooltip title="Attach files">
                <Button
                    type="text"
                    aria-label="Attach files"
                    icon={<Paperclip size={16} />}
                    disabled={disabled}
                    onClick={() => inputRef.current?.click()}
                />
            </Tooltip>
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

/** Names only — the real tray, with previews and upload progress, is the chat's. */
export const SeedAttachmentChips = ({
    files,
    onChange,
}: {
    files: File[]
    onChange: (files: File[]) => void
}) => {
    if (!files.length) return null
    return (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
            {files.map((file, index) => (
                <span
                    key={`${file.name}-${index}`}
                    className="inline-flex items-center gap-1 rounded border border-solid border-colorBorderSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary"
                >
                    <span className="max-w-40 truncate">{file.name}</span>
                    <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => onChange(files.filter((_, at) => at !== index))}
                        className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-colorTextTertiary"
                    >
                        <X size={10} />
                    </button>
                </span>
            ))}
        </div>
    )
}
