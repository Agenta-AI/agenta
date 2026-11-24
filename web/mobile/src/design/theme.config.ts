// Every theme variable and its job. Rules and reasons live in web/mobile/DESIGN.md.

export type ThemeMode = "light" | "dark"

export interface ColorValue {
    light: string
    dark: string
}

export interface ThemeVariable<V = string> {
    name: string
    value: V
    usage: string
}

export interface TextStyle {
    name: string
    family: "sans" | "mono"
    fontSize: string
    lineHeight: string
    fontWeight: number
    letterSpacing?: string
    usage: string
}

export const colors: ThemeVariable<ColorValue>[] = [
    {name: "background", value: {light: "#fefdfc", dark: "#0f0e0d"}, usage: "Main content area. The ground for every text color."},
    {name: "foreground", value: {light: "#1f1e1c", dark: "#eeecea"}, usage: "Primary text and icons (≥12:1). Also the tooltip fill and the inner focus ring."},
    {name: "muted", value: {light: "#f8f6f4", dark: "#151412"}, usage: "Sidebar, the right pane and grouped blocks. Separates an area by tone, not by a border."},
    {name: "muted-foreground", value: {light: "#605d59", dark: "#9a9893"}, usage: "Secondary text: descriptions, meta, timestamps, placeholders, inactive nav, icon buttons (≥4.5:1 on every surface)."},
    {name: "secondary", value: {light: "#1f1e1c0a", dark: "#eeecea0a"}, usage: "Fill of quiet controls: secondary button, segmented control, chips, Marks, user chat turns. Ink at 4%, so it stays one step darker than any surface it sits on, hover included."},
    {name: "accent", value: {light: "#1f1e1c0d", dark: "#eeecea0f"}, usage: "The one hover fill: rows, nav items, menu items and ghost controls. Ink at 5% (6% in dark), so hover is one step darker than the surface under it, and fills inside the row stay visible."},
    {name: "selected", value: {light: "#ebe9e6", dark: "#262422"}, usage: "Selected row, active nav item, pressed state."},
    {name: "popover", value: {light: "#fefdfc", dark: "#1c1b19"}, usage: "Menus, popovers, dialogs, sheets, toasts. A step lighter than background in dark."},
    {name: "overlay", value: {light: "rgba(15, 14, 13, 0.40)", dark: "rgba(0, 0, 0, 0.60)"}, usage: "Dims the page behind a dialog or sheet."},
    // Media: the same in both themes, because they sit on images, video and brand logos.
    {
        name: "scrim",
        value: {light: "rgba(0, 0, 0, 0.55)", dark: "rgba(0, 0, 0, 0.55)"},
        usage: "Media only: the dark film behind captions and controls on images and video.",
    },
    {
        name: "on-scrim",
        value: {light: "#ffffff", dark: "#ffffff"},
        usage: "Media only: text and icons on scrim.",
    },
    {
        name: "logo-ground",
        value: {light: "#ffffff", dark: "#ffffff"},
        usage: "Media only: the white tile behind a third-party brand logo.",
    },
    // Data: categories and chart series only (span types, file kinds, agent Marks, chart lines). Never UI state.
    {name: "data-1", value: {light: "#4f7cac", dark: "#7ea6d4"}, usage: "Data only: first category or series."},
    {name: "data-2", value: {light: "#5b8f68", dark: "#86bd93"}, usage: "Data only: second category or series."},
    {name: "data-3", value: {light: "#b07d36", dark: "#d8ad6b"}, usage: "Data only: third category or series."},
    {name: "data-4", value: {light: "#8a64a3", dark: "#b796cc"}, usage: "Data only: fourth category or series."},
    {name: "data-5", value: {light: "#b5605f", dark: "#dc9190"}, usage: "Data only: fifth category or series."},
    {name: "data-6", value: {light: "#3f8a8a", dark: "#74bcbc"}, usage: "Data only: sixth category or series."},
    {name: "on-data", value: {light: "#ffffff", dark: "#0f0e0d"}, usage: "Data only: letters and glyphs on a data-* fill."},
    // Code: syntax colors in code blocks and editors only. Comments and punctuation take muted-foreground.
    {name: "code-keyword", value: {light: "#76518f", dark: "#b796cc"}, usage: "Code only: keywords and operators."},
    {name: "code-string", value: {light: "#3b6f4d", dark: "#86bd93"}, usage: "Code only: strings."},
    {name: "code-number", value: {light: "#855711", dark: "#d8ad6b"}, usage: "Code only: numbers and constants."},
    {name: "code-function", value: {light: "#386492", dark: "#7ea6d4"}, usage: "Code only: function, class and tag names."},
    {name: "code-property", value: {light: "#2a6d6d", dark: "#74bcbc"}, usage: "Code only: property names and keys."},
    {name: "border", value: {light: "#e2e0dc", dark: "#2f2d2a"}, usage: "Card edges, inputs and outline buttons at rest."},
    {name: "border-muted", value: {light: "#ebe9e6", dark: "#242220"}, usage: "Dividers inside a card or list."},
    {name: "border-strong", value: {light: "#797773", dark: "#7c7a76"}, usage: "Edges that carry meaning: checkbox, switch, radio, hovered input (≥3:1 on every surface)."},
    {name: "primary", value: {light: "#242424", dark: "#f2f25c"}, usage: "LOCKED. The default (primary) button. Ink in light, brand yellow in dark."},
    {name: "primary-hover", value: {light: "#413f3f", dark: "#e8e47e"}, usage: "LOCKED. Primary hover."},
    {name: "brand", value: {light: "#f2f25c", dark: "#d1d151"}, usage: "LOCKED brand yellow. The one brand action, New agent on Home. Tint: brand/15."},
    {name: "brand-hover", value: {light: "#e7e712", dark: "#dcdc6b"}, usage: "LOCKED. Brand hover."},
    {name: "brand-foreground", value: {light: "#242424", dark: "#141414"}, usage: "Text on brand."},
    {name: "link", value: {light: "#5e5e08", dark: "#8ccfff"}, usage: "LOCKED. Inline links."},
    {name: "ring", value: {light: "#d9d92c", dark: "#d9d92c"}, usage: "LOCKED brand lime. Outer focus outline, always with a foreground ring inside it."},
    {name: "destructive", value: {light: "#b6322d", dark: "#f66d62"}, usage: "Errors and destructive actions. Text, icons and the confirm button; tint with destructive/10."},
    {name: "success", value: {light: "#007835", dark: "#37bb62"}, usage: "Passed, done. Text and icons; tint with success/10."},
    {name: "warning", value: {light: "#965802", dark: "#df8605"}, usage: "Needs attention. Text and icons; tint with warning/10."},
    {name: "info", value: {light: "#0068a5", dark: "#1fa6ff"}, usage: "Running, informational. Text and icons; tint with info/10."},
]

// shadcn slot names the kit expects; each points at a core color. Tailwind mapping only.
export const colorAliases: Record<string, string> = {
    card: "background",
    "card-foreground": "foreground",
    "primary-foreground": "background",
    "destructive-foreground": "background",
    "popover-foreground": "foreground",
    "secondary-foreground": "foreground",
    "accent-foreground": "foreground",
    "selected-foreground": "foreground",
    input: "border",
    "ring-offset": "foreground",
    sidebar: "muted",
    "sidebar-foreground": "muted-foreground",
    "sidebar-accent": "selected",
    "sidebar-accent-foreground": "foreground",
    "sidebar-border": "border-muted",
    "sidebar-ring": "ring",
}

// `--font-inter` and `--font-jetbrains-mono` hold the self-hosted next/font faces (src/features/app/AppFonts.tsx).
export const fontFamilies = {
    sans: 'var(--font-inter, "Inter"), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, SFMono-Regular, Menlo, monospace',
}

export const textStyles: TextStyle[] = [
    {name: "text-display", family: "sans", fontSize: "28px", lineHeight: "34px", fontWeight: 600, letterSpacing: "-0.02em", usage: "The Home greeting, first-run hero screens, and the title on auth and error pages. Nowhere else."},
    {name: "text-heading", family: "sans", fontSize: "20px", lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.015em", usage: "Page titles. One per page, the anchor of the alignment line."},
    {name: "text-title", family: "sans", fontSize: "16px", lineHeight: "22px", fontWeight: 600, letterSpacing: "-0.01em", usage: "Card and dialog titles."},
    {name: "text-body", family: "sans", fontSize: "14px", lineHeight: "22px", fontWeight: 400, usage: "Chat messages, descriptions, prose. Multi-line text."},
    {name: "text-label", family: "sans", fontSize: "13px", lineHeight: "18px", fontWeight: 500, usage: "The default for controls, nav, list rows and labels. Single-line text. The kit applies it through text-btn-md and text-field-md."},
    {name: "text-body-sm", family: "sans", fontSize: "13px", lineHeight: "20px", fontWeight: 400, usage: "13px text that can wrap: field and cell values, card descriptions, short secondary prose."},
    {name: "text-subtitle", family: "sans", fontSize: "13px", lineHeight: "18px", fontWeight: 600, usage: "Section and panel titles inside a page or the right pane."},
    {name: "text-metric", family: "sans", fontSize: "20px", lineHeight: "28px", fontWeight: 500, usage: "A number that is the point of a tile: credits, counts, scores. With tabular-nums."},
    {name: "text-meta", family: "sans", fontSize: "12px", lineHeight: "16px", fontWeight: 450, usage: "Meta lines, timestamps, secondary table cells."},
    {name: "text-caption", family: "sans", fontSize: "11px", lineHeight: "16px", fontWeight: 500, letterSpacing: "0.01em", usage: "Badges, keyboard hints, and the letter in a 16–24px Mark."},
    {name: "text-code", family: "mono", fontSize: "13px", lineHeight: "20px", fontWeight: 400, usage: "Code blocks, JSON, tool calls."},
    {name: "text-code-sm", family: "mono", fontSize: "12px", lineHeight: "16px", fontWeight: 500, usage: "Inline code, IDs, keys."},
]

export const spacing: ThemeVariable[] = [
    {name: "spacing-0.5", value: "2px", usage: "Hairline offsets."},
    {name: "spacing-1", value: "4px", usage: "The tightest gap: inside badges and xs buttons, between grouped buttons, inside menus."},
    {name: "spacing-1.5", value: "6px", usage: "Gaps inside a control."},
    {name: "spacing-2", value: "8px", usage: "Gaps inside a row."},
    {name: "spacing-3", value: "12px", usage: "List row side padding. Gap between a label and its field group."},
    {name: "spacing-4", value: "16px", usage: "Page gutter on compact windows; card padding."},
    {name: "spacing-5", value: "20px", usage: "Dialog padding."},
    {
        name: "spacing-6",
        value: "24px",
        usage: "Gap between the page top band and the body; the right pane's own margins; section gap on compact.",
    },
    {
        name: "spacing-8",
        value: "32px",
        usage: "Top of every page above the page top band; section gap on medium and expanded windows.",
    },
    {name: "spacing-10", value: "40px", usage: "Space above an empty state."},
    {name: "spacing-12", value: "48px", usage: "Page top padding on expanded windows."},
    {name: "spacing-16", value: "64px", usage: "Largest layout gap."},
]

export const radius: ThemeVariable[] = [
    {name: "radius-xs", value: "2px", usage: "Status dots, timeline nodes, skeleton bars and thin bars of 4–8px."},
    {name: "radius-sm", value: "4px", usage: "Badges, kbd, chips, menu items, checkboxes, 16 and 20px Marks."},
    {name: "radius-md", value: "6px", usage: "Controls, inputs, nav items, 24 and 32px Marks."},
    {
        name: "radius-lg",
        value: "8px",
        usage: "Cards, menus, popovers, banners, toasts, the 40px Mark.",
    },
    {
        name: "radius-xl",
        value: "12px",
        usage: "Dialogs and sheets. Inner parts use radius-lg (12 − 4 padding).",
    },
]

export const sizes: ThemeVariable[] = [
    {name: "control-xs", value: "24px", usage: "Controls inside inputs and dense toolbars."},
    {
        name: "control-sm",
        value: "28px",
        usage: 'Small controls: size="sm" buttons and selects, toolbar and row actions.',
    },
    {
        name: "control-md",
        value: "32px",
        usage: "The default control height: buttons, inputs and selects.",
    },
    {name: "control-lg", value: "40px", usage: "The composer and the brand action on Home."},
    {
        name: "control-md-compact",
        value: "28px",
        usage: "control-md on a compact window (below 640px): the default control steps down one size.",
    },
    {
        name: "control-lg-compact",
        value: "32px",
        usage: "control-lg on a compact window (below 640px).",
    },
    {name: "icon-xs", value: "10px", usage: "Icons inside a 16px Mark."},
    {name: "icon-sm", value: "12px", usage: "Icons in badges and xs buttons, and in a 20px Mark."},
    {name: "icon-md", value: "14px", usage: "Icons in 28px controls, and in a 24px Mark."},
    {
        name: "icon-lg",
        value: "16px",
        usage: "Icons in menu rows, list rows, tabs and 32px controls, and in a 32px Mark.",
    },
    {name: "icon-xl", value: "20px", usage: "Icons inside a 40px Mark."},
    {name: "mark-xs", value: "16px", usage: "Mark inside text, in nav and in menus. Radius radius-sm, icon 10."},
    {name: "mark-sm", value: "20px", usage: "Mark in pickers and composer chips. Radius radius-sm, icon 12."},
    {name: "mark-md", value: "24px", usage: "Mark in list rows (default). Radius radius-md, icon 14."},
    {name: "mark-lg", value: "32px", usage: "Mark in the page top band, dialog headers and cards. Radius radius-md, icon 16."},
    {name: "mark-xl", value: "40px", usage: "Mark in empty states. Radius radius-lg, icon 20."},
    {
        name: "header-h",
        value: "44px",
        usage: "The compact header: the one bar at the top of a compact window. Medium and expanded windows have none; the page top band holds the title.",
    },
    {name: "sidebar-w", value: "240px", usage: "Sidebar width on medium and expanded windows."},
    {name: "sidebar-w-closed", value: "48px", usage: "Sidebar width when it is closed."},
    {
        name: "page-margin",
        value: "80px",
        usage: "Smallest margin on each side of the content column on medium and expanded windows. More room grows both margins equally.",
    },
    {
        name: "page-band",
        value: "148px",
        usage: "The page top band: the title and the page actions, the same height on every page.",
    },
    {name: "popover-sm", value: "240px", usage: "Menus."},
    {name: "popover-md", value: "320px", usage: "Pickers and popovers with search."},
    {name: "popover-lg", value: "400px", usage: "Rich popovers."},
    {name: "content-sm", value: "560px", usage: "Dialogs, forms, settings."},
    {name: "content-md", value: "760px", usage: "Chat column, documents."},
    {name: "content-lg", value: "1040px", usage: "Lists and tables."},
    {
        name: "panel-side",
        value: "320px",
        usage: "The right pane: a layout slot on every page that any feature can fill (details, activity, the agent chat, a preview). One thing at a time. Its own 24px margins and alignment line.",
    },
    {name: "row-dense", value: "28px", usage: "Height of a tree row or a rail row."},
    {name: "row-single", value: "36px", usage: "Height of a one-line list row."},
    {name: "row-double", value: "48px", usage: "Height of a two-line list row (title + meta)."},
    {name: "border-w", value: "1px", usage: "Every border and divider."},
]

export const durations: ThemeVariable[] = [
    {name: "duration-fast", value: "120ms", usage: "Hover, press, toggles."},
    {name: "duration-base", value: "200ms", usage: "Menus, popovers, view swaps."},
    {name: "duration-slow", value: "320ms", usage: "Sheets, dialogs, page transitions."},
]

export const easings: ThemeVariable[] = [
    {name: "ease-out", value: "cubic-bezier(0.2, 0.8, 0.2, 1)", usage: "Things that enter."},
    {
        name: "ease-in-out",
        value: "cubic-bezier(0.4, 0, 0.2, 1)",
        usage: "Things that move on screen.",
    },
]

export const breakpoints: ThemeVariable[] = [
    {
        name: "breakpoint-sm",
        value: "640px",
        usage: "From here: two-pane layouts, popovers instead of sheets.",
    },
    {name: "breakpoint-lg", value: "1024px", usage: "From here: permanent sidebar."},
]

export const zIndex: ThemeVariable[] = [
    {name: "z-sticky", value: "10", usage: "Sticky headers and composers."},
    {name: "z-modal", value: "40", usage: "Dialogs and sheets."},
    {
        name: "z-popover",
        value: "50",
        usage: "Menus, selects and popovers; above dialogs so a Select inside a Dialog opens on top. Portal them to body.",
    },
    {name: "z-toast", value: "60", usage: "Toasts."},
    {name: "z-tooltip", value: "70", usage: "Tooltips."},
]

export const shadows: ThemeVariable<{light: string; dark: string}>[] = [
    {
        name: "shadow-raised",
        value: {
            light: "0 1px 2px rgba(31, 30, 28, 0.08), 0 2px 8px -2px rgba(31, 30, 28, 0.08)",
            dark: "0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
        },
        usage: "A card while it is dragged.",
    },
    {
        name: "shadow-overlay",
        value: {
            light: "0 8px 24px -6px rgba(31, 30, 28, 0.16), 0 2px 6px -2px rgba(31, 30, 28, 0.10), 0 0 0 1px rgba(31, 30, 28, 0.06)",
            dark: "0 8px 24px -6px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07)",
        },
        usage: "Menus, popovers, tooltips, toasts.",
    },
    {
        name: "shadow-modal",
        value: {
            light: "0 24px 48px -12px rgba(31, 30, 28, 0.25), 0 0 0 1px rgba(31, 30, 28, 0.06)",
            dark: "0 24px 48px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.07)",
        },
        usage: "Dialogs and sheets.",
    },
]
