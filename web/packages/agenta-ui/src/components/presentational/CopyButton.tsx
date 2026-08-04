/**
 * CopyButton Component
 *
 * A button that copies text to clipboard with visual feedback.
 * Shows a checkmark icon briefly after successful copy.
 *
 * @example
 * ```tsx
 * import { CopyButton } from '@agenta/ui'
 *
 * // Simple usage
 * <CopyButton text="Hello World" />
 *
 * // Icon only
 * <CopyButton text={apiKey} icon buttonText={null} />
 *
 * // Custom button text
 * <CopyButton text={code} buttonText="Copy Code" />
 * ```
 */

import type {ComponentProps} from "react"
import {memo, useState} from "react"

import {Check, Copy} from "@phosphor-icons/react"

import {message} from "../../utils/appMessageContext"
import {copyToClipboard} from "../../utils/copyToClipboard"
import {Button} from "../ui/button"

// ============================================================================
// TYPES
// ============================================================================

export interface CopyButtonProps extends Omit<ComponentProps<typeof Button>, "onClick"> {
    /**
     * Text to copy to clipboard
     */
    text: string
    /**
     * Button label text. Set to null to hide text.
     * @default "Copy"
     */
    buttonText?: string | null
    /**
     * Whether to show the copy icon
     * @default false
     */
    icon?: boolean
    /**
     * Whether to stop event propagation on click
     * @default false
     */
    stopPropagation?: boolean
    /**
     * Success message to show after copying
     * @default "Copied to clipboard!"
     */
    successMessage?: string
    /**
     * Callback after successful copy
     */
    onCopy?: () => void
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A button that copies text to clipboard with visual feedback
 */
export const CopyButton = memo(function CopyButton({
    text,
    buttonText = "Copy",
    icon = false,
    stopPropagation = false,
    successMessage = "Copied to clipboard!",
    onCopy,
    ...props
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false)

    const handleClick = async (e: React.MouseEvent<HTMLElement>) => {
        if (stopPropagation) {
            e.stopPropagation()
        }

        if (!text) return

        const success = await copyToClipboard(text)
        if (success) {
            if (successMessage) {
                message.success(successMessage)
            }
            setCopied(true)
            onCopy?.()

            // Reset icon after 3 seconds
            setTimeout(() => {
                setCopied(false)
            }, 3000)
        }
    }

    const iconNode = copied ? <Check size={14} /> : <Copy size={14} />

    return (
        <Button variant="outline" onClick={handleClick} {...props}>
            {icon ? iconNode : undefined}
            {buttonText}
        </Button>
    )
})

export default CopyButton
