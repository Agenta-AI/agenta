/** Class maps @agenta/ui/styles used to export. */

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
