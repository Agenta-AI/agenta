import {useCallback, useMemo, useRef, useState} from "react"

import {MinusCircleOutlined} from "@ant-design/icons"
import {FileArchive} from "@phosphor-icons/react"
import {Button, Input, Typography, Upload} from "antd"
import clsx from "clsx"

import {useStyles} from "../PromptImageUpload/assets/styles"
import {
    PromptDocumentUploadProps,
    PromptDocumentUploadPropertyProps,
} from "./types"
import {isBase64, dataUriToObjectUrl} from "@/oss/lib/helpers/utils"

const isUrl = (value: string): boolean => {
    const match =
        value.match(/^blob:http?:\/\//) ||
        value.match(/^https?:\/\//) ||
        value.match(/^blob:https?:\/\//)
    return Boolean(match)
}

const {Dragger} = Upload
const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB

const PromptDocumentUpload = ({disabled, onRemove, ...rest}: PromptDocumentUploadProps) => {
    const classes = useStyles()
    const uploadRef = useRef<HTMLInputElement>(null)

    const [error, setError] = useState("")
    const [fileSource, setFileSource] = useState<"upload" | "input" | null>(null)

    // Derive the raw value (base64, URL, or empty) from props and only transform to blob URL
    // when the actual data changes. This avoids regenerating object URLs every re-render.
    const isValueMode = rest.mode === "value"
    const valueProps = isValueMode ? rest : undefined
    const propertyProps = !isValueMode ? (rest as PromptDocumentUploadPropertyProps) : undefined

    const fileDataCandidate =
        valueProps?.value?.file_data ?? propertyProps?.fileDataValue ?? undefined
    const fileIdCandidate = valueProps?.value?.file_id ?? propertyProps?.fileIdValue ?? undefined

    const rawValue = useMemo(
        () => fileDataCandidate || fileIdCandidate || "",
        [fileDataCandidate, fileIdCandidate],
    )

    const value = useMemo(() => {
        if (isBase64(rawValue)) {
            return dataUriToObjectUrl(rawValue)
        }
        return rawValue
    }, [rawValue])

    const setValue = useCallback(
        (value: string, filename?: string) => {
            if (rest.mode === "value") {
                // Route to correct field based on content type
                if (value.startsWith("data:")) {
                    // Base64 data URL → use file_data
                    rest.onValueChange({
                        file_data: value,
                        filename: filename || rest.value.filename || "uploaded_file.pdf",
                        format: "application/pdf",
                    })
                } else {
                    // Regular URL or file ID → use file_id
                    rest.onValueChange({
                        file_id: value,
                        // Also set filename/format for URLs to satisfy validation
                        filename: filename || "document",
                        format: "application/pdf",
                    })
                }
            } else {
                const isDataUrl = value.startsWith("data:")
                const targetPropertyId = isDataUrl
                    ? rest.fileDataPropertyId || rest.fileIdPropertyId
                    : rest.fileIdPropertyId || rest.fileDataPropertyId

                if (targetPropertyId) rest.onChange(targetPropertyId, value)

                // Clear the opposite property to avoid stale values
                if (
                    isDataUrl &&
                    rest.fileIdPropertyId &&
                    rest.fileIdPropertyId !== targetPropertyId
                ) {
                    rest.onChange(rest.fileIdPropertyId, "")
                } else if (
                    !isDataUrl &&
                    rest.fileDataPropertyId &&
                    rest.fileDataPropertyId !== targetPropertyId
                ) {
                    rest.onChange(rest.fileDataPropertyId, "")
                }

                // ALWAYS set the filename if provided and we have a property ID for it
                // This is required by validation regardless of whether it's a URL or base64
                if (rest.filenamePropertyId) {
                    const name = filename || (isDataUrl ? "uploaded_file.pdf" : "document")
                    rest.onChange(rest.filenamePropertyId, name)
                }

                // ALWAYS set the format if provided and we have a property ID for it
                // This is required by validation regardless of whether it's a URL or base64
                if (rest.formatPropertyId) {
                    const format = "application/pdf"
                    rest.onChange(rest.formatPropertyId, format)
                }
            }
        },
        [rest],
    )

    const handleUpload = useCallback(
        (file: File) => {
            if (file.size > MAX_FILE_SIZE) {
                setError("File too large. Please upload a PDF smaller than 8 MB.")
                return Upload.LIST_IGNORE
            }
            const isPdf =
                file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")
            if (!isPdf) {
                setError("Unsupported format. Please upload a PDF file.")
                return Upload.LIST_IGNORE
            }

            const reader = new FileReader()
            reader.onload = () => {
                const result = reader.result
                if (typeof result !== "string") {
                    setError("Failed to read file.")
                    return
                }
                setError("")
                setValue(result, file.name)
                setFileSource("upload")
            }
            reader.onerror = () => setError("Failed to read file.")
            reader.readAsDataURL(file)
            return Upload.LIST_IGNORE
        },
        [setValue],
    )

    const handleFileInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0]
            if (file) handleUpload(file)
            event.target.value = ""
        },
        [handleUpload],
    )

    const triggerUpload = useCallback((event: React.MouseEvent) => {
        event.stopPropagation()
        uploadRef.current?.click()
    }, [])

    const handleBeforeUpload = useCallback(
        (file: File) => {
            handleUpload(file)
            setFileSource(null)
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
                    classes.uploadDragger,
                    "py-2 pr-1 pl-2 rounded-md",
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
                            fill={value ? "green" : error ? "#D61010" : "#758391"}
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
                                value={value}
                                onChange={(e) => {
                                    if (fileSource !== "upload") {
                                        setValue(e.target.value.trim())
                                        if (!fileSource) {
                                            setFileSource("input")
                                        }
                                    }

                                    setError("")
                                }}
                                type="url"
                                onClear={() => {
                                    setValue("")
                                    setFileSource(null)
                                }}
                                allowClear
                            />

                            {isUrl(value) && (
                                <Typography.Link
                                    href={value}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all"
                                    type="secondary"
                                >
                                    Preview: {rest?.filenameValue}
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
