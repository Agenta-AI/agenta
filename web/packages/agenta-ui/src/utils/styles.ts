/**
 * Styling Utilities
 *
 * Shared utilities for CSS class names and styling constants.
 * Values are the design-system theme variables (src/design/theme.config.ts).
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
 * Text color classes. The design system has two text levels: `foreground` and
 * `muted-foreground` (web/DESIGN.md, principle 6). Every quiet role maps to the second.
 *
 * @example
 * <span className={textColors.secondary}>{secondaryText}</span>
 */
export const textColors = {
    /** Primary text */
    primary: "text-foreground",
    /** Secondary text */
    secondary: "text-muted-foreground",
    /** Tertiary text */
    tertiary: "text-muted-foreground",
    /** Quaternary text (there is no third gray) */
    quaternary: "text-muted-foreground",
    /** Muted text - alias for tertiary */
    muted: "text-muted-foreground",
    /** Separator text */
    separator: "text-muted-foreground",
    /** Icon color */
    icon: "text-muted-foreground",
    /** Icon hover color */
    iconHover: "hover:text-foreground",
    /** Label text */
    label: "text-muted-foreground",
    /** Subtle text */
    subtle: "text-muted-foreground",
    /** Description text */
    description: "text-muted-foreground",
    /** Placeholder text */
    placeholder: "text-muted-foreground",
    /** Disabled text */
    disabled: "text-muted-foreground",
} as const

/**
 * Background color classes. Fills inside rows are translucent (`secondary`) so they stay
 * visible on the row's `accent` hover (SURF-06).
 *
 * @example
 * <span className={bgColors.chip}>{badge}</span>
 */
export const bgColors = {
    /** Chip/badge background */
    chip: "bg-secondary",
    /** Subtle background */
    subtle: "bg-secondary",
    /** Hover background */
    hover: "bg-accent",
    /** Hover state background - for hover pseudo-class */
    hoverState: "hover:bg-accent",
    /** Active/selected background */
    active: "bg-selected",
    /** Container background */
    container: "bg-background",
    /** Elevated (floating) background */
    elevated: "bg-popover",
    /** Hover subtle - for hover states on subtle backgrounds */
    hoverSubtle: "hover:bg-accent",
} as const

/**
 * Border color classes.
 *
 * @example
 * <div className={borderColors.default} />
 */
export const borderColors = {
    /** Default border - card edges, inputs */
    default: "border-border",
    /** Secondary/subtle border - dividers inside a card or list */
    secondary: "border-border-muted",
    /** Divider/separator border */
    divider: "border-border-muted",
    /** Strong border - edges that carry meaning */
    strong: "border-border-strong",
} as const

/**
 * Interactive element styles. Hover is `accent` (SURF-05).
 *
 * @example
 * <span className={interactiveStyles.expandIcon}>...</span>
 */
export const interactiveStyles = {
    /** Expand/collapse icon styling */
    expandIcon: "cursor-pointer text-muted-foreground hover:text-foreground transition-colors",
    /** Expand icon with inline-flex */
    expandIconInline:
        "cursor-pointer text-muted-foreground hover:text-foreground transition-colors inline-flex items-center",
    /** Clickable text - secondary to primary on hover */
    clickableText: "cursor-pointer text-muted-foreground hover:text-foreground transition-colors",
    /** Subtle button - for icon buttons */
    subtleButton:
        "cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
} as const

/**
 * Status color classes: one color per status, tinted at 10% for a fill.
 *
 * @example
 * <span className={statusColors.success}>Success</span>
 */
export const statusColors = {
    /** Success text */
    success: "text-success",
    /** Success background */
    successBg: "bg-success/10",
    /** Success icon */
    successIcon: "text-success",
    /** Warning text */
    warning: "text-warning",
    /** Warning background */
    warningBg: "bg-warning/10",
    /** Error text */
    error: "text-destructive",
    /** Error background */
    errorBg: "bg-destructive/10",
    /** Info text */
    info: "text-info",
    /** Info background */
    infoBg: "bg-info/10",
} as const

/**
 * Entity icon color classes. Marks are neutral (COLOR-05): `secondary` with a
 * `muted-foreground` icon; only status takes a status color.
 *
 * @example
 * <EntityIconLabel iconBgColor={entityIconColors.primaryBg} iconColor={entityIconColors.primary} />
 */
export const entityIconColors = {
    /** Primary icon color */
    primary: "text-muted-foreground",
    /** Primary icon background */
    primaryBg: "bg-secondary",
    /** Connected/success icon color */
    connected: "text-success",
    /** Connected/success icon background */
    connectedBg: "bg-success/10",
} as const

/**
 * Shadow classes. Flat content has no shadow (SURF-03); only floating things do.
 *
 * @example
 * <div className={shadows.elevated}>Menu</div>
 */
export const shadows = {
    /** Cards are flat: tone or a border separates them */
    card: "",
    /** Menus, popovers, tooltips, toasts */
    elevated: "shadow-overlay",
    /** Dialogs and sheets */
    modal: "shadow-modal",
} as const

/**
 * Text size classes, mapped to the design-system text styles.
 *
 * @example
 * <span className={textSizes.xs}>Meta text</span>
 * <span className={textSizes.sm}>Default text</span>
 */
export const textSizes = {
    /** Meta text - 12px */
    xs: "text-meta",
    /** Single-line UI text - 13px */
    sm: "text-label",
    /** Prose - 14px */
    base: "text-body",
    /** Section title - 16px */
    lg: "text-title",
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
 * Focus styles. Every control uses the shared `focus-ring` (FORM-02, `@agenta/ui/focus.css`).
 *
 * @example
 * <button className={cn("rounded", focusStyles.ring)}>Click me</button>
 */
export const focusStyles = {
    /** Standard focus ring */
    ring: "outline-none focus-ring",
    /** Same ring; the shared ring has no offset */
    ringOffset: "outline-none focus-ring",
    /** Keyboard-only focus (the shared ring already uses :focus-visible) */
    ringVisible: "outline-none focus-ring",
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
 * Common modal size presets
 * Used for consistent modal dimensions across the application
 *
 * @example
 * <Modal width={modalSizes.medium.width} styles={{ body: { height: modalSizes.medium.height } }} />
 */
export const modalSizes = {
    /** Small modal - for simple confirmations and inputs */
    small: {width: 480, height: 320},
    /** Medium modal - for forms and selections */
    medium: {width: 800, height: 520},
    /** Large modal - for complex content with sidebars */
    large: {width: 1150, height: 560},
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
 * Link color classes. Links use `link`.
 *
 * @example
 * <a className={linkColors.default}>Link text</a>
 * <button className={cn(linkColors.default, linkColors.hover)}>Click</button>
 */
export const linkColors = {
    /** Default link color */
    default: "text-link",
    /** Link hover state */
    hover: "hover:underline",
} as const

/**
 * Danger/destructive action colors.
 *
 * @example
 * <button className={cn(dangerColors.text, dangerColors.hover)}>Delete</button>
 */
export const dangerColors = {
    /** Danger text color */
    text: "text-destructive",
    /** Danger hover state */
    hover: "hover:text-destructive",
} as const

/** "smooth", or "auto" under reduced motion (MOTION-02): for `scrollIntoView` and `scrollTo`. */
export const scrollBehavior = (): ScrollBehavior =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
