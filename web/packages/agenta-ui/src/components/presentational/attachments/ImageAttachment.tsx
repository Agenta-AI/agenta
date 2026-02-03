/**
 * ImageAttachment Component
 *
 * An image preview with an optional remove button.
 * Used for displaying image attachments in chat messages.
 *
 * @example
 * ```tsx
 * import { ImageAttachment } from '@agenta/ui'
 *
 * // With custom preview component
 * <ImageAttachment
 *   src="https://example.com/image.jpg"
 *   alt="Preview"
 *   onRemove={() => handleRemove()}
 *   ImagePreview={MyCustomPreview}
 * />
 *
 * // Simple usage
 * <ImageAttachment
 *   src={imageUrl}
 *   alt="Attachment"
 *   disabled
 * />
 * ```
 */

import React from "react"

import {cn} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface ImageAttachmentProps {
    /**
     * Image source URL
     */
    src: string
    /**
     * Alt text for accessibility
     */
    alt?: string
    /**
     * Callback when remove button is clicked
     */
    onRemove?: () => void
    /**
     * Whether remove button is disabled
     */
    disabled?: boolean
    /**
     * Image size in pixels
     * @default 64
     */
    size?: number
    /**
     * Optional custom image preview component
     */
    ImagePreview?: React.ComponentType<{
        src: string
        alt: string
        size: number
        isValidPreview: boolean
    }>
    /**
     * Additional CSS class name
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays an image attachment with an optional remove button
 */
export function ImageAttachment({
    src,
    alt = "Attachment",
    onRemove,
    disabled = false,
    size = 64,
    ImagePreview,
    className,
}: ImageAttachmentProps) {
    return (
        <div
            className={cn(
                "relative group rounded-md overflow-hidden border border-gray-200",
                className,
            )}
        >
            {ImagePreview ? (
                <ImagePreview src={src} alt={alt} size={size} isValidPreview={true} />
            ) : (
                <img
                    src={src}
                    alt={alt}
                    className="object-cover"
                    style={{width: size, height: size}}
                />
            )}
            {!disabled && onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-md p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            )}
        </div>
    )
}

export default ImageAttachment
