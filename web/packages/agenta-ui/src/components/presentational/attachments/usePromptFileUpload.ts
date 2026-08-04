/**
 * usePromptFileUpload
 *
 * The file-handling controller shared by `PromptImageUpload` / `PromptDocumentUpload`:
 * MIME/size validation, the `FileReader` data-URL read, error state, the hidden-input
 * wiring, and a native drop-zone (replacing antd `Upload.Dragger` — the components only
 * used the Dragger for drag-and-drop, since click-to-open runs through the hidden input).
 *
 * Each component supplies its own validation rules + `onAccepted` emit; everything impure
 * (DOM file reads, drag events) lives here so the components stay presentational shells.
 */

import {useCallback, useMemo, useRef, useState} from "react"
import type {ChangeEvent, DragEvent, MouseEvent, RefObject} from "react"

export interface UsePromptFileUploadOptions {
    /** Max accepted file size in bytes. */
    maxSize: number
    /** Error shown when a file exceeds `maxSize`. */
    sizeError: string
    /** Returns true when the file's type is accepted. */
    isTypeAllowed: (file: File) => boolean
    /** Error shown when `isTypeAllowed` rejects the file. */
    typeError: string
    /** Called once a file passes validation and has been read to a data URL. */
    onAccepted: (file: File, dataUrl: string) => void
    /** When disabled, the picker and drop target are inert. */
    disabled?: boolean
}

export interface UsePromptFileUpload {
    uploadRef: RefObject<HTMLInputElement | null>
    /** Current validation/read error (empty string when clear). */
    error: string
    setError: (error: string) => void
    /** Open the OS file picker (wire to the "upload a file" button). */
    triggerUpload: (event: MouseEvent) => void
    /** `onChange` for the hidden `<input type="file">`. */
    handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void
    /** Drop-zone handlers for the container (replaces antd `Upload.Dragger`). */
    dropzoneProps: {
        onDragOver: (event: DragEvent) => void
        onDragLeave: (event: DragEvent) => void
        onDrop: (event: DragEvent) => void
    }
    /** True while a file is dragged over the zone (for an optional hover affordance). */
    isDragging: boolean
}

export function usePromptFileUpload({
    maxSize,
    sizeError,
    isTypeAllowed,
    typeError,
    onAccepted,
    disabled,
}: UsePromptFileUploadOptions): UsePromptFileUpload {
    const uploadRef = useRef<HTMLInputElement>(null)
    const [error, setError] = useState("")
    const [isDragging, setIsDragging] = useState(false)

    const handleFile = useCallback(
        (file: File) => {
            if (!isTypeAllowed(file)) {
                setError(typeError)
                return
            }
            if (file.size > maxSize) {
                setError(sizeError)
                return
            }

            const reader = new FileReader()
            reader.onload = () => {
                const result = reader.result
                if (typeof result !== "string") {
                    setError("Failed to read file.")
                    return
                }
                setError("")
                onAccepted(file, result)
            }
            reader.onerror = () => setError("Failed to read file.")
            reader.readAsDataURL(file)
        },
        [isTypeAllowed, typeError, maxSize, sizeError, onAccepted],
    )

    const triggerUpload = useCallback(
        (event: MouseEvent) => {
            event.stopPropagation()
            if (disabled) return
            uploadRef.current?.click()
        },
        [disabled],
    )

    const handleFileInputChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0]
            if (file) handleFile(file)
            // Reset so selecting the same file again still fires onChange.
            event.target.value = ""
        },
        [handleFile],
    )

    const dropzoneProps = useMemo(
        () => ({
            onDragOver: (event: DragEvent) => {
                event.preventDefault()
                if (!disabled) setIsDragging(true)
            },
            onDragLeave: (event: DragEvent) => {
                event.preventDefault()
                setIsDragging(false)
            },
            onDrop: (event: DragEvent) => {
                event.preventDefault()
                setIsDragging(false)
                if (disabled) return
                const file = event.dataTransfer.files?.[0]
                if (file) handleFile(file)
            },
        }),
        [disabled, handleFile],
    )

    return {
        uploadRef,
        error,
        setError,
        triggerUpload,
        handleFileInputChange,
        dropzoneProps,
        isDragging,
    }
}
