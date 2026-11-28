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

import {useT} from "@agenta/i18n"
import uiChatCatalog from "@agenta/i18n/catalogs/ui.chat"
import {FileArchive, X} from "@phosphor-icons/react"

import {Button} from "../../ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../ui/tooltip"
import {cn} from "../../ui/utils"

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
    const t = useT(uiChatCatalog)
    return (
        <div
            className={cn(
                "relative group px-2 py-1 rounded-md border border-solid border-border-muted bg-secondary flex items-center gap-2",
                className,
            )}
        >
            {icon ?? <FileArchive size={16} className="text-muted-foreground" />}
            <span
                className="text-meta text-muted-foreground truncate"
                style={{maxWidth}}
                title={filename}
            >
                {filename}
            </span>
            {!disabled && onRemove && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onRemove}
                                className="!p-0 !h-auto !min-w-0 text-muted-foreground hover:text-destructive"
                            >
                                {<X size={12} />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{t("ui.chat.removeFile")}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    )
}

export default FileAttachment
