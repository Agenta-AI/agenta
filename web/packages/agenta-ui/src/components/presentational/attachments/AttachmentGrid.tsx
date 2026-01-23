/**
 * AttachmentGrid Component
 *
 * A layout container for displaying multiple attachments in a flexible grid.
 * Used for wrapping ImageAttachment and FileAttachment components.
 *
 * @example
 * ```tsx
 * import { AttachmentGrid, ImageAttachment, FileAttachment } from '@agenta/ui'
 *
 * <AttachmentGrid>
 *   <ImageAttachment src={imageUrl} onRemove={() => handleRemove(0)} />
 *   <FileAttachment filename="document.pdf" onRemove={() => handleRemove(1)} />
 * </AttachmentGrid>
 * ```
 */

import React from "react"

import {cn} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface AttachmentGridProps {
    /**
     * Child attachment components
     */
    children: React.ReactNode
    /**
     * Gap between items
     * @default 2 (0.5rem)
     */
    gap?: number
    /**
     * Additional CSS class name
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A flex container for displaying multiple attachments
 */
export function AttachmentGrid({children, gap = 2, className}: AttachmentGridProps) {
    const gapClass = `gap-${gap}`

    return <div className={cn("flex flex-wrap mt-2", gapClass, className)}>{children}</div>
}

export default AttachmentGrid
