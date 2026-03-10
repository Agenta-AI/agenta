/**
 * ImagePreview Component
 *
 * A clickable image thumbnail that opens an Ant Design Modal with a larger preview.
 * Handles base64 data URIs, blob URLs, and regular image URLs with safety validation.
 *
 * @example
 * ```tsx
 * import { ImagePreview } from '@agenta/ui'
 *
 * <ImagePreview
 *   src="https://example.com/image.jpg"
 *   alt="Preview"
 *   size={48}
 *   isValidPreview={true}
 * />
 * ```
 */

import {useMemo, useState} from "react"

import {MagnifyingGlassPlus} from "@phosphor-icons/react"
import {Modal} from "antd"

import ImageWithFallback from "./ImageWithFallback"
import {resolveSafeImagePreviewSrc} from "./utils"

// ============================================================================
// TYPES
// ============================================================================

export interface ImagePreviewProps {
    /** thumbnail & full preview source */
    src: string
    /** alt text */
    alt?: string
    /** square thumbnail size in px (default 48) */
    size?: number
    /** optional className for thumbnail */
    className?: string
    /** optional boolean to disable the preview */
    isValidPreview?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Small clickable image thumbnail that opens an Ant Design Modal with a larger preview.
 */
const ImagePreview = ({
    src,
    alt = "Preview",
    size = 48,
    className = "",
    isValidPreview = true,
}: ImagePreviewProps) => {
    const [open, setOpen] = useState(false)

    const imageURL = useMemo(() => {
        return resolveSafeImagePreviewSrc(src)
    }, [src])

    return (
        <>
            <div
                className={`relative group rounded overflow-hidden cursor-pointer flex-shrink-0 ${className}`}
                style={{width: size, height: size}}
                onClick={(e) => {
                    e.stopPropagation()
                    setOpen(true)
                }}
            >
                <ImageWithFallback
                    src={imageURL}
                    alt={alt}
                    className="w-full h-full object-cover group-hover:opacity-80 transition duration-200"
                />
                <div className="absolute inset-0 bg-black bg-opacity-10 group-hover:bg-opacity-20 transition duration-200" />
                <div className="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition duration-200">
                    <MagnifyingGlassPlus size={16} weight="bold" />
                </div>
            </div>
            <Modal
                open={open}
                footer={null}
                onCancel={() => setOpen(false)}
                centered
                width={800}
                height={600}
            >
                {isValidPreview && imageURL && (
                    <img
                        src={imageURL}
                        alt={alt}
                        className="w-full h-full max-h-[600px] max-w-[800px] object-contain"
                    />
                )}
            </Modal>
        </>
    )
}

export default ImagePreview
