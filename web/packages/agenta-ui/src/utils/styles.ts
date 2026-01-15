/**
 * Styling Utilities
 *
 * Shared utilities for CSS class names and styling constants.
 *
 * @example
 * ```tsx
 * import {cn, sizeClasses} from '@agenta/ui'
 *
 * <span className={cn(sizeClasses.small, isActive && "active")} />
 * ```
 */

type ClassValue =
    | string
    | undefined
    | null
    | false
    | Record<string, boolean | undefined>
    | ClassValue[]

/**
 * Utility function for conditionally joining class names.
 * Supports strings, arrays, and objects (like clsx).
 *
 * @param classes - Class names, undefined, false, arrays, or objects with boolean values
 * @returns Joined class name string
 *
 * @example
 * cn("base", isActive && "active", undefined, "always")
 * // => "base active always"
 *
 * cn("base", {"active": true, "disabled": false})
 * // => "base active"
 *
 * cn(["class1", "class2"], "class3")
 * // => "class1 class2 class3"
 */
export function cn(...classes: ClassValue[]): string {
    const result: string[] = []

    for (const cls of classes) {
        if (!cls) continue

        if (typeof cls === "string") {
            result.push(cls)
        } else if (Array.isArray(cls)) {
            const nested = cn(...cls)
            if (nested) result.push(nested)
        } else if (typeof cls === "object") {
            for (const [key, value] of Object.entries(cls)) {
                if (value) result.push(key)
            }
        }
    }

    return result.join(" ")
}

// ============================================================================
// SHARED STYLING CONSTANTS
// ============================================================================

/**
 * Size classes mapped to size variants
 * Note: Text size should inherit from parent context, not be set explicitly.
 * These are kept for backwards compatibility but are empty strings.
 *
 * @example
 * <span className={sizeClasses[size]}>Text</span>
 */
export const sizeClasses = {
    small: "",
    default: "",
    large: "",
} as const

/**
 * Size variant type derived from sizeClasses
 */
export type SizeVariant = keyof typeof sizeClasses

/**
 * Common flex layout patterns
 *
 * @example
 * <span className={cn(flexLayouts.inlineCenter, "gap-2")}>
 *   <Icon /> Label
 * </span>
 */
export const flexLayouts = {
    /** Inline flex with centered items - for inline badges and labels */
    inlineCenter: "inline-flex items-center",
    /** Flex row with centered items - for rows and headers */
    rowCenter: "flex items-center",
    /** Flex column layout - for stacked content */
    column: "flex flex-col",
} as const

/**
 * Common text color classes for semantic styling
 *
 * @example
 * <span className={textColors.muted}>{secondaryText}</span>
 */
export const textColors = {
    /** Muted/secondary text - for descriptions, dates, secondary info */
    muted: "text-gray-500",
    /** Separator/divider text - for path separators, subtle dividers */
    separator: "text-gray-400",
    /** Icon color - for icons in inputs, lists */
    icon: "text-gray-400",
    /** Icon hover color */
    iconHover: "hover:text-gray-600",
    /** Label text - for small labels, section headers */
    label: "text-gray-500",
    /** Subtle text - for counts, totals, end-of-list messages */
    subtle: "text-gray-400",
} as const

/**
 * Common background color classes
 *
 * @example
 * <span className={bgColors.chip}>{badge}</span>
 */
export const bgColors = {
    /** Chip/badge background */
    chip: "bg-gray-100",
} as const

/**
 * Common border color classes
 *
 * @example
 * <div className={borderColors.divider} />
 */
export const borderColors = {
    /** Divider/separator border */
    divider: "border-gray-200",
} as const

/**
 * Interactive element styles
 *
 * @example
 * <span className={interactiveStyles.expandIcon}>...</span>
 */
export const interactiveStyles = {
    /** Expand/collapse icon styling */
    expandIcon: "cursor-pointer text-gray-400 hover:text-gray-600 transition-colors",
    /** Expand icon with inline-flex */
    expandIconInline:
        "cursor-pointer text-gray-400 hover:text-gray-600 transition-colors inline-flex items-center",
} as const
