/**
 * Styling Utilities
 *
 * Shared utilities for CSS class names and styling constants.
 * Uses Ant Design theme tokens from antd-tailwind.json for design system consistency.
 *
 * Token Reference (from antd-tailwind.json):
 * - zinc-1 to zinc-10: Gray scale (zinc-5 = #97a4b0, zinc-6 = #758391, zinc-7 = #586673, zinc-9 = #1c2c3d)
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
    /** Flex row - basic horizontal layout */
    row: "flex",
    /** Flex row with centered items - for rows and headers */
    rowCenter: "flex items-center",
    /** Flex row that grows to fill available space */
    rowGrow: "flex grow",
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
    /** Hover state background - for hover pseudo-class */
    hoverState: "hover:bg-zinc-2",
    /** Active/selected background - controlItemBgActive - zinc-1 (#f5f7fa) */
    active: "bg-zinc-1",
    /** Container background - colorBgContainer (#ffffff) */
    container: "bg-white",
    /** Elevated background - colorBgElevated (#ffffff) */
    elevated: "bg-white",
    /** Hover subtle - for hover states on subtle backgrounds */
    hoverSubtle: "hover:bg-zinc-1",
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
    /** Success icon - green-6 */
    successIcon: "text-green-6",
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
 * Entity icon color classes for consistent icon styling
 * Used in entity headers, panels, and list items
 *
 * @example
 * <EntityIconLabel iconBgColor={entityIconColors.primaryBg} iconColor={entityIconColors.primary} />
 */
export const entityIconColors = {
    /** Primary icon color - blue-6 */
    primary: "text-blue-6",
    /** Primary icon background - blue-1 */
    primaryBg: "bg-blue-1",
    /** Connected/success icon color - green-6 */
    connected: "text-green-6",
    /** Connected/success icon background - green-1 */
    connectedBg: "bg-green-1",
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

/**
 * Text size classes for consistent typography
 * Use these instead of hardcoded Tailwind text size classes
 *
 * @example
 * <span className={textSizes.xs}>Small text</span>
 * <span className={textSizes.sm}>Default text</span>
 */
export const textSizes = {
    /** Extra small text - 12px */
    xs: "text-xs",
    /** Small text - 14px (default body) */
    sm: "text-sm",
    /** Base text - 16px */
    base: "text-base",
    /** Large text - 18px */
    lg: "text-lg",
} as const

/**
 * Justify content classes for flex layouts
 *
 * @example
 * <div className={cn("flex", justifyClasses.between)}>...</div>
 */
export const justifyClasses = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
} as const

/**
 * Focus ring styles for accessibility
 * Uses zinc-5 for consistent focus indication across components
 *
 * @example
 * <button className={cn("rounded", focusStyles.ring)}>Click me</button>
 */
export const focusStyles = {
    /** Standard focus ring - 2px zinc-5 */
    ring: "outline-none focus:ring-2 focus:ring-zinc-5",
    /** Focus ring with offset for elements with backgrounds */
    ringOffset: "outline-none focus:ring-2 focus:ring-zinc-5 focus:ring-offset-2",
    /** Focus-visible variant for keyboard-only focus */
    ringVisible: "outline-none focus-visible:ring-2 focus-visible:ring-zinc-5",
} as const

/**
 * Common layout size values in pixels
 * Used for consistent panel widths across modal and split layouts
 *
 * @example
 * <SplitPanelLayout leftWidth={layoutSizes.sidebarNarrow} ... />
 */
export const layoutSizes = {
    /** Narrow sidebar/panel width - 280px */
    sidebarNarrow: 280,
    /** Wide sidebar/panel width - 320px */
    sidebarWide: 320,
} as const

/**
 * Common spacing/padding classes
 * Used for consistent padding across panels and containers
 *
 * @example
 * <div className={spacingClasses.panel}>Content</div>
 */
export const spacingClasses = {
    /** Standard panel padding - p-4 (16px) */
    panel: "p-4",
    /** Compact padding - p-3 (12px) */
    compact: "p-3",
    /** Large padding - p-6 (24px) */
    large: "p-6",
    /** Card padding - px-4 py-3 (16px horizontal, 12px vertical) */
    card: "px-4 py-3",
} as const

/**
 * Gap classes for flex/grid layouts
 * Use these instead of hardcoded Tailwind gap classes
 *
 * @example
 * <div className={cn("flex", gapClasses.md)}>...</div>
 */
export const gapClasses = {
    /** No gap - 0px */
    none: "gap-0",
    /** Extra small gap - 4px */
    xs: "gap-1",
    /** Small gap - 8px */
    sm: "gap-2",
    /** Medium gap - 12px */
    md: "gap-3",
    /** Large gap - 16px */
    lg: "gap-4",
    /** Extra large gap - 24px */
    xl: "gap-6",
} as const

/**
 * Link color classes for consistent link styling
 * Uses Ant Design primary color tokens
 *
 * @example
 * <a className={linkColors.default}>Link text</a>
 * <button className={cn(linkColors.default, linkColors.hover)}>Click</button>
 */
export const linkColors = {
    /** Default link color - primary blue */
    default: "text-primary",
    /** Link hover state */
    hover: "hover:text-primary-6 hover:underline",
} as const

/**
 * Danger/destructive action colors
 * Uses Ant Design error color tokens
 *
 * @example
 * <button className={cn(dangerColors.text, dangerColors.hover)}>Delete</button>
 */
export const dangerColors = {
    /** Danger text color */
    text: "text-red-6",
    /** Danger hover state */
    hover: "hover:text-red-7",
} as const
