/**
 * Styling Utilities
 *
 * Shared utilities for CSS class names and styling constants.
 * Uses Ant Design theme tokens from antd-tailwind.json for design system consistency.
 *
 * Token Reference (from antd-tailwind.json):
 * - zinc-1 to zinc-10: Gray scale (zinc-6 = #758391, zinc-7 = #586673, zinc-9 = #1c2c3d)
 * - colorText: #1c2c3d (primary text)
 * - colorTextSecondary: #586673 (secondary text)
 * - colorTextTertiary: #758391 (tertiary/muted text)
 * - colorTextQuaternary: #bdc7d1 (disabled/placeholder text)
 * - colorIcon: #758391 (icon color)
 * - colorIconHover: #1c2c3d (icon hover color)
 * - colorBorder: #bdc7d1 (primary border)
 * - colorBorderSecondary: #eaeff5 (secondary border)
 * - colorFillSecondary: rgba(5, 23, 41, 0.06) (subtle fill)
 * - colorFillTertiary: rgba(5, 23, 41, 0.04) (very subtle fill)
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
// Uses Ant Design theme tokens for design system consistency
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
 * Uses Ant Design theme tokens: colorTextSecondary (#586673), colorTextTertiary (#758391), colorIcon (#758391)
 *
 * @example
 * <span className={textColors.secondary}>{secondaryText}</span>
 */
export const textColors = {
    /** Primary text - colorText (#1c2c3d) - zinc-9 */
    primary: "text-zinc-9",
    /** Secondary text - colorTextSecondary (#586673) - zinc-7 */
    secondary: "text-zinc-7",
    /** Tertiary/muted text - colorTextTertiary (#758391) - zinc-6 */
    tertiary: "text-zinc-6",
    /** Quaternary/disabled text - colorTextQuaternary (#bdc7d1) - zinc-4 */
    quaternary: "text-zinc-4",
    /** Muted/secondary text - alias for tertiary (colorTextTertiary) */
    muted: "text-zinc-6",
    /** Separator/divider text - colorTextQuaternary (#bdc7d1) - zinc-4 */
    separator: "text-zinc-4",
    /** Icon color - colorIcon (#758391) - zinc-6 */
    icon: "text-zinc-6",
    /** Icon hover color - colorIconHover (#1c2c3d) - zinc-9 */
    iconHover: "hover:text-zinc-9",
    /** Label text - colorTextSecondary (#586673) - zinc-7 */
    label: "text-zinc-7",
    /** Subtle text - colorTextTertiary (#758391) - zinc-6 */
    subtle: "text-zinc-6",
    /** Description text - colorTextDescription (#758391) - zinc-6 */
    description: "text-zinc-6",
    /** Placeholder text - colorTextPlaceholder (#bdc7d1) - zinc-4 */
    placeholder: "text-zinc-4",
    /** Disabled text - colorTextDisabled (#bdc7d1) - zinc-4 */
    disabled: "text-zinc-4",
} as const

/**
 * Common background color classes
 * Uses Ant Design theme tokens: colorFillSecondary, colorFillTertiary, zinc scale
 *
 * @example
 * <span className={bgColors.chip}>{badge}</span>
 */
export const bgColors = {
    /** Chip/badge background - colorFillSecondary - zinc-1 (#f5f7fa) */
    chip: "bg-zinc-1",
    /** Subtle background - colorFillTertiary - zinc-1 (#f5f7fa) */
    subtle: "bg-zinc-1",
    /** Hover background - colorFillSecondary - zinc-2 (#eaeff5) */
    hover: "bg-zinc-2",
    /** Active/selected background - controlItemBgActive - zinc-1 (#f5f7fa) */
    active: "bg-zinc-1",
    /** Container background - colorBgContainer (#ffffff) */
    container: "bg-white",
    /** Elevated background - colorBgElevated (#ffffff) */
    elevated: "bg-white",
} as const

/**
 * Common border color classes
 * Uses Ant Design theme tokens: colorBorder (#bdc7d1), colorBorderSecondary (#eaeff5)
 *
 * @example
 * <div className={borderColors.default} />
 */
export const borderColors = {
    /** Default border - colorBorder (#bdc7d1) - zinc-4 */
    default: "border-zinc-4",
    /** Secondary/subtle border - colorBorderSecondary (#eaeff5) - zinc-2 */
    secondary: "border-zinc-2",
    /** Divider/separator border - colorBorderSecondary (#eaeff5) - zinc-2 */
    divider: "border-zinc-2",
    /** Strong border - zinc-3 (#d6dee6) */
    strong: "border-zinc-3",
} as const

/**
 * Interactive element styles
 * Uses Ant Design theme tokens for consistent hover states
 *
 * @example
 * <span className={interactiveStyles.expandIcon}>...</span>
 */
export const interactiveStyles = {
    /** Expand/collapse icon styling - colorIcon to colorIconHover */
    expandIcon: "cursor-pointer text-zinc-6 hover:text-zinc-9 transition-colors",
    /** Expand icon with inline-flex */
    expandIconInline:
        "cursor-pointer text-zinc-6 hover:text-zinc-9 transition-colors inline-flex items-center",
    /** Clickable text - secondary to primary on hover */
    clickableText: "cursor-pointer text-zinc-7 hover:text-zinc-9 transition-colors",
    /** Subtle button - for icon buttons */
    subtleButton: "cursor-pointer text-zinc-6 hover:text-zinc-9 hover:bg-zinc-1 transition-colors",
} as const

/**
 * Status color classes based on Ant Design semantic colors
 *
 * @example
 * <span className={statusColors.success}>Success</span>
 */
export const statusColors = {
    /** Success text - colorSuccessText (#389e0d) - green-7 */
    success: "text-green-7",
    /** Success background - colorSuccessBg (#f6ffed) - green-1 */
    successBg: "bg-green-1",
    /** Warning text - colorWarningText (#faad14) - gold-6 */
    warning: "text-gold-6",
    /** Warning background - colorWarningBg (#fffbe6) - gold-1 */
    warningBg: "bg-gold-1",
    /** Error text - colorErrorText (#d61010) - red-6 */
    error: "text-red-6",
    /** Error background - colorErrorBg (#fbe7e7) - red-1 */
    errorBg: "bg-red-1",
    /** Info text - colorInfoText (#1c2c3d) - zinc-9 */
    info: "text-zinc-9",
    /** Info background - colorInfoBg (#f5f7fa) - zinc-1 */
    infoBg: "bg-zinc-1",
} as const

/**
 * Common shadow classes
 *
 * @example
 * <div className={shadows.card}>Card content</div>
 */
export const shadows = {
    /** Subtle shadow for cards */
    card: "shadow-sm",
    /** Elevated shadow for dropdowns/popovers */
    elevated: "shadow-md",
    /** Strong shadow for modals */
    modal: "shadow-lg",
} as const
