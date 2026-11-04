import {useRef, useState, type DragEvent} from "react"

import {Button} from "@agenta/ui/ui"
import {FileText, UploadSimple, X} from "@phosphor-icons/react"

import {FileFormatHint} from "./FileFormatHint"
import {FilePreviewTable} from "./FilePreviewTable"

/**
 * The file area of the create dialog: a drop target that opens the file picker on a click, and
 * once a file is set, its name bar and the first rows. A refused file shows its message under
 * the drop target.
 */
export const TestsetFileDrop = ({
    file,
    preview,
    error,
    disabled = false,
    onFile,
    onRemove,
}: {
    file: File | null
    preview: Record<string, unknown>[]
    error: string | null
    disabled?: boolean
    onFile: (file: File) => void
    onRemove: () => void
}) => {
    const input = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)

    const onDrop = (event: DragEvent) => {
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files[0]
        if (dropped && !disabled) onFile(dropped)
    }

    if (file) {
        return (
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-solid border-border px-3 py-2">
                    <FileText aria-hidden size={18} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {file.name}
                    </span>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Remove file"
                        disabled={disabled}
                        onClick={onRemove}
                    >
                        <X aria-hidden size={14} />
                    </Button>
                </div>
                <FilePreviewTable rows={preview} />
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <button
                type="button"
                disabled={disabled}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed bg-transparent px-4 py-8 text-sm text-foreground ${
                    dragging ? "border-primary bg-muted" : "border-border"
                }`}
            >
                <UploadSimple aria-hidden size={24} className="text-muted-foreground" />
                Click or drag file to this area to upload
            </button>
            <input
                ref={input}
                type="file"
                accept=".csv,.json"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                data-testid="testset-file-input"
                onChange={(event) => {
                    const chosen = event.target.files?.[0]
                    if (chosen) onFile(chosen)
                    // Choosing the same file again must still fire.
                    event.target.value = ""
                }}
            />
            <FileFormatHint />
            {error ? (
                <p role="alert" className="m-0 text-xs text-destructive">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
