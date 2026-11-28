/**
 * Styling Utilities
 *
 * `cn` (the one class-name combiner, with tailwind-merge) and the shared layout sizes.
 * Write theme-variable classes as literals (web/DESIGN.md): `text-muted-foreground`,
 * `border-border-muted`, `bg-accent`.
 *
 * @example
 * ```tsx
 * import {cn} from '@agenta/ui/styles'
 *
 * <span className={cn("text-muted-foreground", isActive && "text-foreground")} />
 * ```
 */

export {cn} from "./cn"

/** Size variant of the presentational labels. The text inherits its size from the parent. */
export type SizeVariant = "small" | "default" | "large"

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

/** "smooth", or "auto" under reduced motion (MOTION-02): for `scrollIntoView` and `scrollTo`. */
export const scrollBehavior = (): ScrollBehavior =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
