/**
 * PromptImageUpload Component
 *
 * Drag-and-drop image upload with URL input support.
 * Supports file upload (JPEG, PNG, WebP, GIF up to 5MB) and pasting image URLs.
 *
 * File-handling (validation, `FileReader`, drop-zone) lives in `usePromptFileUpload`;
 * this component owns the image-specific URL-preview state + rendering.
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
import {Image as ImageIcon, MinusCircle} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "../../ui/button"
import {InputAffix} from "../../ui/input-composed"
import {Progress} from "../../ui/progress"
import {Spinner} from "../../ui/spinner"

import ImagePreview from "./ImagePreview"
import {usePromptFileUpload} from "./usePromptFileUpload"
import {resolveSafeImagePreviewSrc} from "./utils"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Local, antd-free stand-in for antd `UploadFile` (only the fields this flow uses).
 * The index signature keeps it permissive so antd `UploadFile` stays structurally
 * assignable in both directions.
 */
export interface PromptUploadFile {
    uid: string
    name: string
    status?: "error" | "success" | "done" | "uploading" | "removed"
    url?: string
    thumbUrl?: string
    percent?: number
    size?: number
    type?: string
    originFileObj?: File | Blob
    base64?: string | ArrayBuffer | null
    [key: string]: unknown
}

export interface PromptImageUploadProps {
    disabled?: boolean
    handleUploadFileChange: (file: PromptUploadFile | null) => void
    handleRemoveUploadFile: () => void
    imageFile?: PromptUploadFile
}

// ============================================================================
// CONSTANTS
// ============================================================================

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
    const fileUploadRef = useRef(false)

    const [draftValue, setDraftValue] = useState<string | null>(null)
    const [isValidPreview, setIsValidPreview] = useState(false)

    const {
        uploadRef,
        error,
        setError,
        triggerUpload,
        handleFileInputChange,
        dropzoneProps,
        isDragging,
    } = usePromptFileUpload({
        maxSize: MAX_SIZE,
        sizeError: "Image size must be less than 5MB.",
        isTypeAllowed: (file) => ALLOWED_TYPES.includes(file.type),
        typeError: "Unsupported image format. Use JPEG, PNG, WebP, or GIF.",
        disabled,
        onAccepted: (file, dataUrl) => {
            const previewUrl = URL.createObjectURL(file)

            handleUploadFileChange({
                uid: generateId(),
                name: file.name,
                status: "done",
                originFileObj: file,
                base64: dataUrl,
                thumbUrl: previewUrl,
                type: file.type,
                size: file.size,
            })

            // Show the preview but skip the URL-validation effect below —
            // handleUploadFileChange already fired.
            fileUploadRef.current = true
            setDraftValue(dataUrl)
        },
    })

    const status = error ? "error" : imageFile?.status || ""

    const imageBase64 = imageFile?.base64

    const resolvedRawValue = useMemo(() => {
        if (draftValue !== null) return draftValue
        const candidate = imageBase64 || imageFile?.url || imageFile?.thumbUrl || ""
        return typeof candidate === "string" ? candidate : ""
    }, [draftValue, imageBase64, imageFile?.thumbUrl, imageFile?.url])

    const displayValue = useMemo(() => {
        if (!resolvedRawValue) return ""
        return resolveSafeImagePreviewSrc(resolvedRawValue) ?? resolvedRawValue
    }, [resolvedRawValue])

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

    const renderUnified = () => {
        const isUploading = status === "uploading"

        return (
            <div className="flex items-center gap-4 w-full">
                {isUploading ? (
                    <div className="flex size-12 items-center justify-center">
                        <Spinner size="large" />
                    </div>
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
                        className={clsx(error ? "text-colorError" : "text-colorTextTertiary")}
                    />
                )}

                <div className="flex flex-col w-full items-start">
                    <span className="text-xs">
                        Drag an image here or{" "}
                        <Button variant="link" className="p-0 underline" onClick={triggerUpload}>
                            upload a file
                        </Button>
                    </span>

                    {!isUploading && (
                        <InputAffix
                            placeholder="(Optionally) Enter a valid URL"
                            value={displayValue}
                            onValueChange={(next) => {
                                setDraftValue(next)
                                setError("")
                            }}
                            type="url"
                            allowClear
                        />
                    )}

                    {isUploading && (
                        <Progress size="small" percent={imageFile?.percent} showInfo={false} />
                    )}

                    {error && <span className="mt-1 text-xs text-colorError">{error}</span>}
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
                {/* `w-full`: antd's `.ant-upload-drag-container` was `display:table;width:100%`,
                    so this row stretched for free. Without it the URL input ends ~9px short. */}
                <div className="flex w-full items-center gap-1">
                    {renderUnified()}
                    {/* `size="icon"` reproduces antd's implicit `.ant-btn-icon-only` sizing —
                        without it the default horizontal padding pushes this row past its
                        container and squeezes the URL input. */}
                    <Button
                        disabled={disabled}
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveUploadFile()
                            setDraftValue("")
                            setError("")
                            setIsValidPreview(false)
                        }}
                    >
                        <MinusCircle size={16} />
                    </Button>
                </div>
            </div>
        </>
    )
}

export default PromptImageUpload
