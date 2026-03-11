/**
 * PromptImageUpload Component
 *
 * Drag-and-drop image upload with URL input support.
 * Supports file upload (JPEG, PNG, WebP, GIF up to 5MB) and pasting image URLs.
 *
 * @example
 * ```tsx
 * import { PromptImageUpload } from '@agenta/ui/components/presentational'
 *
 * <PromptImageUpload
 *   imageFile={file}
 *   handleUploadFileChange={setFile}
 *   handleRemoveUploadFile={() => setFile(null)}
 * />
 * ```
 */

import {useEffect, useMemo, useRef, useState} from "react"

import {generateId} from "@agenta/shared/utils"
import {LoadingOutlined, MinusCircleOutlined} from "@ant-design/icons"
import {Image as ImageIcon} from "@phosphor-icons/react"
import {Button, Input, Progress, Spin, Typography, Upload} from "antd"
import type {UploadFile} from "antd"
import clsx from "clsx"

import ImagePreview from "./ImagePreview"
import {resolveSafeImagePreviewSrc} from "./utils"

// ============================================================================
// TYPES
// ============================================================================

export interface PromptImageUploadProps {
    disabled?: boolean
    handleUploadFileChange: (file: UploadFile | null) => void
    handleRemoveUploadFile: () => void
    imageFile?: UploadFile
}

// ============================================================================
// CONSTANTS
// ============================================================================

const {Dragger} = Upload

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

// ============================================================================
// UTILITIES
// ============================================================================

const isValidImageUrl = (value: string): boolean => {
    try {
        const isHttp = value.startsWith("http://") || value.startsWith("https://")
        const isDataUrl = /^data:image\/(png|jpeg|webp|gif);base64,/.test(value)
        return isHttp || isDataUrl
    } catch {
        return false
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

const PromptImageUpload = ({
    disabled,
    handleRemoveUploadFile,
    handleUploadFileChange,
    imageFile,
}: PromptImageUploadProps) => {
    const uploadRef = useRef<HTMLInputElement>(null)
    const fileUploadRef = useRef(false)

    const [draftValue, setDraftValue] = useState<string | null>(null)
    const [error, setError] = useState("")
    const [isValidPreview, setIsValidPreview] = useState(false)
    const status = error ? "error" : imageFile?.status || ""

    const imageBase64 = (imageFile as UploadFile & {base64?: string})?.base64

    const resolvedRawValue = useMemo(() => {
        if (draftValue !== null) return draftValue
        const candidate = imageBase64 || imageFile?.url || imageFile?.thumbUrl || ""
        return typeof candidate === "string" ? candidate : ""
    }, [draftValue, imageBase64, imageFile?.thumbUrl, imageFile?.url])

    const displayValue = useMemo(() => {
        if (!resolvedRawValue) return ""
        return resolveSafeImagePreviewSrc(resolvedRawValue) ?? resolvedRawValue
    }, [resolvedRawValue])

    const triggerUpload = (e: React.MouseEvent) => {
        e.stopPropagation()
        uploadRef.current?.click()
    }

    const validateUrlInput = (val: string) => {
        if (!val) {
            setError("")
            setIsValidPreview(false)
            return
        }

        if (!isValidImageUrl(val)) {
            setError("Invalid URL format.")
            setIsValidPreview(false)
            return
        }

        const img = new Image()
        img.src = val

        img.onload = () => {
            setError("")
            setIsValidPreview(true)

            handleUploadFileChange({
                uid: `url-${generateId()}`,
                name: val,
                status: "done",
                url: val,
                thumbUrl: val,
                originFileObj: undefined,
                type: "external/url",
            })
        }

        img.onerror = () => {
            setIsValidPreview(false)
            setError("Preview failed due to CORS or invalid image URL.")
        }
    }

    useEffect(() => {
        if (draftValue !== null) {
            if (fileUploadRef.current) {
                fileUploadRef.current = false
                setIsValidPreview(true)
                return
            }
            validateUrlInput(draftValue)
        }
    }, [draftValue])

    useEffect(() => {
        if (draftValue !== null) return
        const hasPreview = Boolean(imageFile?.thumbUrl || imageFile?.url)
        setIsValidPreview(hasPreview)
        if (!hasPreview) setError("")
    }, [draftValue, imageFile?.thumbUrl, imageFile?.url])

    const handleFile = (file: File) => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            setError("Unsupported image format. Use JPEG, PNG, WebP, or GIF.")
            return
        }

        if (file.size > MAX_SIZE) {
            setError("Image size must be less than 5MB.")
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            const previewUrl = URL.createObjectURL(file)

            handleUploadFileChange({
                uid: generateId(),
                name: file.name,
                status: "done",
                originFileObj: file as unknown as UploadFile["originFileObj"],
                base64: reader.result,
                thumbUrl: previewUrl,
                type: file.type,
                size: file.size,
            } as UploadFile & {base64: string | ArrayBuffer | null})

            // Set draftValue for preview display but skip the useEffect
            // validation path — handleUploadFileChange was already called above.
            fileUploadRef.current = true
            setDraftValue(reader.result as string)
            setError("")
        }
        reader.onerror = () => setError("Failed to read file.")
        reader.readAsDataURL(file)
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) handleFile(file)
    }

    const handleBeforeUpload = (file: File) => {
        handleFile(file)
        return false
    }

    const renderUnified = () => {
        const isUploading = status === "uploading"

        return (
            <div className="flex items-center gap-4 w-full">
                {isUploading ? (
                    <Spin indicator={<LoadingOutlined style={{fontSize: 48}} spin />} />
                ) : isValidPreview ? (
                    <ImagePreview
                        src={displayValue}
                        alt="Preview"
                        size={48}
                        isValidPreview={isValidPreview}
                    />
                ) : (
                    <ImageIcon
                        size={48}
                        className={clsx(error ? "text-[#D61010]" : "text-[#758391]")}
                    />
                )}

                <div className="flex flex-col w-full items-start">
                    <Typography.Text>
                        Drag an image here or{" "}
                        <Button type="link" className="p-0 underline" onClick={triggerUpload}>
                            upload a file
                        </Button>
                    </Typography.Text>

                    {!isUploading && (
                        <Input
                            placeholder="(Optionally) Enter a valid URL"
                            value={displayValue}
                            onChange={(e) => {
                                setDraftValue(e.target.value)
                                setError("")
                            }}
                            type="url"
                            allowClear
                        />
                    )}

                    {isUploading && (
                        <Progress size="small" percent={imageFile?.percent} showInfo={false} />
                    )}

                    {error && (
                        <Typography.Text className="text-[#D61010] mt-1">{error}</Typography.Text>
                    )}
                </div>
            </div>
        )
    }

    return (
        <>
            <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFileInputChange}
            />

            <Dragger
                accept="image/*"
                showUploadList={false}
                openFileDialogOnClick={false}
                beforeUpload={handleBeforeUpload}
                disabled={disabled}
                className={clsx(
                    "w-full flex items-center gap-4 py-2 pr-1 pl-2 rounded-md",
                    "[&_.ant-upload-drag]:bg-transparent [&_.ant-upload-drag]:border-none",
                    "[&_.ant-upload-btn]:!p-0",
                    "border border-solid border-[#BDC7D1]",
                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                    {
                        "!border-[#D61010]": error,
                        "!border-solid": status === "done" && !error,
                    },
                )}
            >
                <div className="flex items-center gap-1">
                    {renderUnified()}
                    <Button
                        disabled={disabled}
                        icon={<MinusCircleOutlined />}
                        type="text"
                        onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveUploadFile()
                            setDraftValue("")
                            setError("")
                            setIsValidPreview(false)
                        }}
                    />
                </div>
            </Dragger>
        </>
    )
}

export default PromptImageUpload
