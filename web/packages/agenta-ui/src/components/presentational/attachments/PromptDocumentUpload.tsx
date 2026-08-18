/**
 * PromptDocumentUpload Component
 *
 * Drag-and-drop PDF upload with URL input support.
 * Supports file upload (PDF up to 8MB) and pasting document URLs.
 *
 * File-handling (validation, `FileReader`, drop-zone) lives in `usePromptFileUpload`;
 * this component owns the PDF-specific value sync + rendering.
 *
 * @example
 * ```tsx
 * import { PromptDocumentUpload } from '@agenta/ui/components/presentational'
 *
 * <PromptDocumentUpload
 *   onFileChange={(fileData, filename, format) => handleFile(fileData, filename, format)}
 *   onRemove={() => removeSlot()}
 * />
 * ```
 */

import {useEffect, useMemo, useState} from "react"

import {dataUriToObjectUrl, isBase64} from "@agenta/shared/utils"
import {FileArchive, MinusCircle} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "../../ui/button"
import {InputAffix} from "../../ui/input-composed"

import {usePromptFileUpload} from "./usePromptFileUpload"

// ============================================================================
// TYPES
// ============================================================================

export interface PromptDocumentUploadProps {
    disabled?: boolean
    value?: string
    onFileChange: (fileData: string, filename: string, format: string) => void
    onRemove: () => void
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB

// ============================================================================
// UTILITIES
// ============================================================================

const isUrl = (value: string): boolean => {
    return /^(blob:)?https?:\/\//.test(value)
}

// ============================================================================
// COMPONENT
// ============================================================================

const PromptDocumentUpload = ({
    disabled,
    value,
    onFileChange,
    onRemove,
}: PromptDocumentUploadProps) => {
    const [rawValue, setRawValue] = useState("")

    const {
        uploadRef,
        error,
        setError,
        triggerUpload,
        handleFileInputChange,
        dropzoneProps,
        isDragging,
    } = usePromptFileUpload({
        maxSize: MAX_FILE_SIZE,
        sizeError: "File too large. Please upload a PDF smaller than 8 MB.",
        isTypeAllowed: (file) =>
            file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf"),
        typeError: "Unsupported format. Please upload a PDF file.",
        disabled,
        onAccepted: (file, dataUrl) => {
            setRawValue(dataUrl)
            onFileChange(dataUrl, file.name, file.type)
        },
    })

    useEffect(() => {
        if (value === undefined) return
        setRawValue((prev) => (prev === value ? prev : value))
        setError("")
    }, [value, setError])

    const displayValue = useMemo(() => {
        if (!rawValue) return ""
        return isBase64(rawValue) ? dataUriToObjectUrl(rawValue) : rawValue
    }, [rawValue])

    return (
        <>
            <input
                ref={uploadRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={handleFileInputChange}
            />

            {/* Native drop-zone (replaces antd Upload.Dragger — only drag-and-drop was
                used; click-to-open runs through the hidden input above). */}
            <div
                {...dropzoneProps}
                className={clsx(
                    // `box-border` is load-bearing: preflight is off, so without it the padding
                    // and border add to `w-full` and the row overflows its container by 14px
                    // (antd's own reset gave the Dragger border-box for free).
                    "w-full box-border flex items-center gap-4 py-2 pr-1 pl-2 rounded-md border border-solid",
                    error ? "border-colorError" : "border-colorBorder",
                    isDragging && !disabled && "border-colorPrimary",
                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
            >
                <div className="flex items-center gap-2 w-full">
                    <div className="flex items-start gap-4 w-full">
                        <FileArchive
                            size={48}
                            className={clsx(
                                displayValue
                                    ? "text-colorSuccess"
                                    : error
                                      ? "text-colorError"
                                      : "text-colorTextTertiary",
                            )}
                        />
                        <div className="flex flex-col items-start gap-1 w-full">
                            <span className="text-xs">
                                Drag a PDF here or{" "}
                                <Button
                                    variant="link"
                                    className="p-0 underline"
                                    onClick={triggerUpload}
                                >
                                    upload a file
                                </Button>
                            </span>
                            <InputAffix
                                disabled={disabled}
                                placeholder="(Optionally) Enter a valid URL."
                                value={displayValue}
                                onChange={(e) => {
                                    const val = e.target.value.trim()
                                    setRawValue(val)
                                    setError("")
                                    if (val && isUrl(val)) {
                                        onFileChange(val, "document", "application/pdf")
                                    }
                                }}
                                type="url"
                                onClear={() => {
                                    setRawValue("")
                                }}
                                allowClear
                            />

                            {isUrl(displayValue) && (
                                <a
                                    href={displayValue}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-start text-xs text-colorTextDescription"
                                >
                                    Preview: document
                                </a>
                            )}
                            {error && <span className="text-xs text-colorError">{error}</span>}
                        </div>
                    </div>
                    {/* `size="icon"` reproduces antd's implicit `.ant-btn-icon-only` sizing —
                        without it the default horizontal padding pushes this row past its
                        container and squeezes the URL input. */}
                    <Button
                        variant="ghost"
                        disabled={disabled}
                        size="icon"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                            setError("")
                        }}
                    >
                        <MinusCircle size={16} />
                    </Button>
                </div>
            </div>
        </>
    )
}

export default PromptDocumentUpload
