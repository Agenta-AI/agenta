/**
 * PromptDocumentUpload Component
 *
 * Drag-and-drop PDF upload with URL input support.
 * Supports file upload (PDF up to 8MB) and pasting document URLs.
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

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {dataUriToObjectUrl, isBase64} from "@agenta/shared/utils"
import {MinusCircleOutlined} from "@ant-design/icons"
import {FileArchive} from "@phosphor-icons/react"
import {Button, Input, Typography, Upload} from "antd"
import clsx from "clsx"

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

const {Dragger} = Upload
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
    const uploadRef = useRef<HTMLInputElement>(null)

    const [rawValue, setRawValue] = useState("")
    const [error, setError] = useState("")

    useEffect(() => {
        if (value === undefined || value === rawValue) return
        setRawValue(value)
        setError("")
    }, [rawValue, value])

    const displayValue = useMemo(() => {
        if (!rawValue) return ""
        return isBase64(rawValue) ? dataUriToObjectUrl(rawValue) : rawValue
    }, [rawValue])

    const triggerUpload = useCallback((event: React.MouseEvent) => {
        event.stopPropagation()
        uploadRef.current?.click()
    }, [])

    const handleUpload = useCallback(
        (file: File) => {
            if (file.size > MAX_FILE_SIZE) {
                setError("File too large. Please upload a PDF smaller than 8 MB.")
                return
            }
            const isPdf =
                file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")
            if (!isPdf) {
                setError("Unsupported format. Please upload a PDF file.")
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
                setRawValue(result)
                onFileChange(result, file.name, file.type)
            }
            reader.onerror = () => setError("Failed to read file.")
            reader.readAsDataURL(file)
        },
        [onFileChange],
    )

    const handleFileInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0]
            if (file) handleUpload(file)
            event.target.value = ""
        },
        [handleUpload],
    )

    const handleBeforeUpload = useCallback(
        (file: File) => {
            handleUpload(file)
            return false
        },
        [handleUpload],
    )

    return (
        <>
            <input
                ref={uploadRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={handleFileInputChange}
            />

            <Dragger
                accept=".pdf,application/pdf"
                multiple={false}
                showUploadList={false}
                openFileDialogOnClick={false}
                disabled={disabled}
                beforeUpload={handleBeforeUpload}
                className={clsx(
                    "w-full flex items-center gap-4 py-2 pr-1 pl-2 rounded-md",
                    "[&_.ant-upload-drag]:bg-transparent [&_.ant-upload-drag]:border-none",
                    "[&_.ant-upload-btn]:!p-0",
                    "border border-solid border-[#BDC7D1]",
                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                    {
                        "!border-[#D61010]": Boolean(error),
                    },
                )}
            >
                <div className="flex items-center gap-2 w-full">
                    <div className="flex items-start gap-4 w-full">
                        <FileArchive
                            size={48}
                            className={clsx(
                                displayValue
                                    ? "text-green-600"
                                    : error
                                      ? "text-[#D61010]"
                                      : "text-[#758391]",
                            )}
                        />
                        <div className="flex flex-col items-start gap-1 w-full">
                            <Typography.Text>
                                Drag a PDF here or{" "}
                                <Button
                                    type="link"
                                    className="p-0 underline"
                                    onClick={triggerUpload}
                                >
                                    upload a file
                                </Button>
                            </Typography.Text>
                            <Input
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
                                <Typography.Link
                                    href={displayValue}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-start"
                                    type="secondary"
                                >
                                    Preview: document
                                </Typography.Link>
                            )}
                            {error && (
                                <Typography.Text className="text-[#D61010]">
                                    {error}
                                </Typography.Text>
                            )}
                        </div>
                    </div>
                    <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        disabled={disabled}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                            setError("")
                        }}
                    />
                </div>
            </Dragger>
        </>
    )
}

export default PromptDocumentUpload
