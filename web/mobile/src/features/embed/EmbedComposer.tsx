import {useRef, useState, type KeyboardEvent} from "react"

import {AutosizeTextarea, Button} from "@agenta/ui/ui"
import {ArrowUp, Paperclip, X} from "@phosphor-icons/react"

/** The visitor's text and files; a refused send keeps the draft. */
export const EmbedComposer = ({
    disabled,
    placeholder,
    onSend,
}: {
    disabled: boolean
    placeholder: string
    onSend: (text: string, files: File[]) => Promise<boolean>
}) => {
    const [text, setText] = useState("")
    const [files, setFiles] = useState<File[]>([])
    const [sending, setSending] = useState(false)
    const picker = useRef<HTMLInputElement>(null)
    const canSend = !disabled && !sending && (text.trim().length > 0 || files.length > 0)

    const submit = async () => {
        if (!canSend) return
        setSending(true)
        const sent = await onSend(text.trim(), files)
        setSending(false)
        if (sent) {
            setText("")
            setFiles([])
        }
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
        }
    }

    return (
        <div className="shrink-0 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {files.length ? (
                <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
                    {files.map((file, index) => (
                        <li
                            key={`${file.name}-${index}`}
                            className="flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-xs text-foreground"
                        >
                            <span className="truncate">{file.name}</span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Remove ${file.name}`}
                                onClick={() => setFiles((all) => all.filter((_, i) => i !== index))}
                            >
                                <X />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}
            <div className="flex items-end gap-2">
                <input
                    ref={picker}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                        const picked = Array.from(event.target.files ?? [])
                        setFiles((all) => [...all, ...picked])
                        event.target.value = ""
                    }}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Attach files"
                    disabled={disabled || sending}
                    onClick={() => picker.current?.click()}
                >
                    <Paperclip />
                </Button>
                <AutosizeTextarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    aria-label="Message"
                    autoSize={{minRows: 1, maxRows: 6}}
                    disabled={disabled}
                    className="grow resize-none text-base sm:text-sm"
                />
                <Button
                    size="icon"
                    aria-label="Send"
                    disabled={!canSend}
                    onClick={() => void submit()}
                >
                    <ArrowUp />
                </Button>
            </div>
        </div>
    )
}
