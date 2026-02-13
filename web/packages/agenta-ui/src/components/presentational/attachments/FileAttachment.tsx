/**
 * FileAttachment Component
 *
 * A file pill with icon, filename, and optional remove button.
 * Used for displaying file attachments in chat messages.
 *
 * @example
 * ```tsx
 * import { FileAttachment } from '@agenta/ui'
 *
 * <FileAttachment
 *   filename="document.pdf"
 *   onRemove={() => handleRemove()}
 * />
 *
 * // Disabled (no remove button)
 * <FileAttachment filename="report.xlsx" disabled />
 * ```
 */

import React from "react"

import {FileArchive, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {
    bgColors,
    borderColors,
    cn,
    dangerColors,
    flexLayouts,
    gapClasses,
    textColors,
    textSizes,
} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface FileAttachmentProps {
    /**
     * Filename to display
     */
    filename: string
    /**
     * Callback when remove button is clicked
     */
    onRemove?: () => void
    /**
     * Whether remove button is disabled
     */
    disabled?: boolean
    /**
     * Maximum width for filename truncation
     * @default 120
     */
    maxWidth?: number
    /**
     * Custom icon to display instead of default FileArchive
     */
    icon?: React.ReactNode
    /**
     * Additional CSS class name
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a file attachment with icon, filename, and optional remove button
 */
export function FileAttachment({
    filename,
    onRemove,
    disabled = false,
    maxWidth = 120,
    icon,
    className,
}: FileAttachmentProps) {
    return (
        <div
            className={cn(
                "relative group px-2 py-1 rounded-md border",
                borderColors.secondary,
                bgColors.subtle,
                flexLayouts.rowCenter,
                gapClasses.sm,
                className,
            )}
        >
            {icon ?? <FileArchive size={16} className={textColors.icon} />}
            <span
                className={cn(textSizes.xs, textColors.secondary, "truncate")}
                style={{maxWidth}}
                title={filename}
            >
                {filename}
            </span>
            {!disabled && onRemove && (
                <Tooltip title="Remove file">
                    <Button
                        type="text"
                        size="small"
                        icon={<X size={12} />}
                        onClick={onRemove}
                        className={cn(
                            "!p-0 !h-auto !min-w-0",
                            textColors.tertiary,
                            dangerColors.hover,
                        )}
                    />
                </Tooltip>
            )}
        </div>
    )
}

export default FileAttachment
