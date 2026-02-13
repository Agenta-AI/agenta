/**
 * ModalContent Component
 *
 * Standardized modal content layout with consistent spacing.
 *
 * @example
 * ```tsx
 * import {ModalContent} from '@agenta/ui'
 *
 * <ModalContent>
 *   <p>Your content here</p>
 *   <Input />
 * </ModalContent>
 * ```
 */

import type {ReactNode} from "react"

// ============================================================================
// TYPES
// ============================================================================

export interface ModalContentProps {
    /** Content to render inside the modal body */
    children: ReactNode
    /** Additional class name for the content container */
    className?: string
    /** Gap size between child elements */
    gap?: "small" | "medium" | "large"
}

// ============================================================================
// COMPONENT
// ============================================================================

const gapClasses = {
    small: "gap-2",
    medium: "gap-4",
    large: "gap-6",
} as const

/**
 * ModalContent
 *
 * A standardized content wrapper for modal dialogs with:
 * - Flex column layout
 * - Consistent vertical spacing
 */
export function ModalContent({children, className, gap = "medium"}: ModalContentProps) {
    const baseClass = "flex flex-col"
    const gapClass = gapClasses[gap]

    return <div className={className ?? `${baseClass} ${gapClass}`}>{children}</div>
}

export default ModalContent
