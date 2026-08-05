/**
 * Token contract for the shadcn primitives in @agenta/ui — utility name → CSS variable.
 *
 * Three consumers compile this: web/oss (Tailwind v3 `theme.extend.colors`), Storybook, and
 * web/mobile (Tailwind v4, via scripts/generate-shadcn-tokens.ts). Shared so a component
 * written against `bg-btn-default-bg` resolves identically everywhere, instead of each app
 * maintaining its own alias table and drifting.
 */
// ── shadcn token bridge ──────────────────────────────────────────
// Semantic token names consumed by the shadcn components in
// @agenta/ui, mapped to the palette-derived --ag-* layer (theme-variables.css,
// generated from palette.ts). ONE shared definition for the app + Storybook: flip
// the underlying layer and every component follows; when antd is removed nothing here
// changes. Purely ADDITIVE — the app uses `colorX`-named + default Tailwind classes,
// never these shadcn names, so nothing is overridden. Radius is intentionally NOT
// bridged (theme-invariant; overriding it would change every `rounded-*` in the app).
export const shadcnTokens = {
    background: "var(--ag-colorBgContainer)",
    foreground: "var(--ag-colorText)",
    border: "var(--ag-colorBorder)",
    input: "var(--ag-colorBorder)",
    ring: "var(--ag-colorPrimary)",
    // antd's keyboard focus ring is `colorPrimaryBorder` (4px, offset 1px). NOTE: it equals
    // colorInfoBorder in LIGHT (both #d6dee6) but diverges in DARK (olive vs navy) — needs its
    // own token, which the forced-state gate caught.
    "focus-ring": "var(--ag-colorPrimaryBorder)",
    primary: {
        DEFAULT: "var(--ag-colorPrimary)",
        // antd fills a CHECKED control with colorPrimaryHover on hover (Radio/Checkbox).
        hover: "var(--ag-colorPrimaryHover)",
        foreground: "var(--ag-colorTextLightSolid)",
    },
    secondary: {DEFAULT: "var(--ag-colorFillSecondary)", foreground: "var(--ag-colorText)"},
    muted: {DEFAULT: "var(--ag-colorFillTertiary)", foreground: "var(--ag-colorTextSecondary)"},
    accent: {DEFAULT: "var(--ag-colorFillSecondary)", foreground: "var(--ag-colorText)"},
    destructive: {DEFAULT: "var(--ag-colorError)", foreground: "var(--ag-colorTextLightSolid)"},
    popover: {DEFAULT: "var(--ag-colorBgElevated)", foreground: "var(--ag-colorText)"},
    card: {DEFAULT: "var(--ag-colorBgContainer)", foreground: "var(--ag-colorText)"},
    placeholder: "var(--ag-colorTextPlaceholder)",
    // Disabled + interaction states used by the control primitives.
    disabled: {
        DEFAULT: "var(--ag-colorTextDisabled)",
        bg: "var(--ag-colorBgContainerDisabled)",
        border: "var(--ag-input-disabled-border)",
    },
    // Semantic status families (Badge/Tag/status chips): {DEFAULT = text, bg, border}.
    success: {
        DEFAULT: "var(--ag-colorSuccess)",
        bg: "var(--ag-colorSuccessBg)",
        border: "var(--ag-colorSuccessBorder)",
    },
    warning: {
        DEFAULT: "var(--ag-colorWarningText)",
        bg: "var(--ag-colorWarningBg)",
        border: "var(--ag-colorWarningBorder)",
    },
    error: {
        DEFAULT: "var(--ag-colorError)",
        bg: "var(--ag-colorErrorBg)",
        border: "var(--ag-colorErrorBorder)",
        hover: "var(--ag-colorErrorHover)",
        active: "var(--ag-colorErrorActive)",
    },
    info: {
        DEFAULT: "var(--ag-colorInfo)",
        bg: "var(--ag-colorInfoBg)",
        border: "var(--ag-colorInfoBorder)",
    },
    draft: {
        DEFAULT: "var(--ag-draft-text)",
        bg: "var(--ag-draft-bg)",
        border: "var(--ag-draft-border)",
    },
    // antd preset Tag colors (color="blue"/"green"). Namespaced `tag-*` to avoid
    // clobbering Tailwind's default `blue`/`green` scales (used across the app).
    "tag-blue": {DEFAULT: "var(--ag-preset-blue-text)", bg: "var(--ag-preset-blue-bg)"},
    "tag-green": {DEFAULT: "var(--ag-preset-green-text)", bg: "var(--ag-preset-green-bg)"},
    "tag-orange": {DEFAULT: "var(--ag-preset-orange-text)", bg: "var(--ag-preset-orange-bg)"},
    "tag-red": {DEFAULT: "var(--ag-preset-red-text)", bg: "var(--ag-preset-red-bg)"},
    "tag-purple": {DEFAULT: "var(--ag-preset-purple-text)", bg: "var(--ag-preset-purple-bg)"},
    "tag-cyan": {DEFAULT: "var(--ag-preset-cyan-text)", bg: "var(--ag-preset-cyan-bg)"},
    "tag-magenta": {DEFAULT: "var(--ag-preset-magenta-text)", bg: "var(--ag-preset-magenta-bg)"},
    "tag-gold": {DEFAULT: "var(--ag-preset-gold-text)", bg: "var(--ag-preset-gold-bg)"},
    // Button state tokens.
    btn: {
        "primary-fg": "var(--ag-btn-primary-text)",
        "primary-hover": "var(--ag-btn-primary-hover)",
        "primary-active": "var(--ag-btn-primary-active)",
        "default-bg": "var(--ag-btn-default-bg)",
        "default-hover-bg": "var(--ag-btn-default-hover-bg)",
        "default-active-bg": "var(--ag-btn-default-active-bg)",
        "text-hover-bg": "var(--ag-btn-text-hover-bg)",
        "text-active-bg": "var(--ag-btn-text-active-bg)",
        link: "var(--ag-btn-link)",
        "link-hover": "var(--ag-btn-link-hover)",
        "link-active": "var(--ag-btn-link-active)",
    },
    // antd Empty's DEFAULT illustration greys (opaque — see palette.ts `emptyImage`).
    empty: {
        shadow: "var(--ag-empty-shadow)",
        sheet: "var(--ag-empty-sheet)",
        flap: "var(--ag-empty-flap)",
        front: "var(--ag-empty-front)",
        hole: "var(--ag-empty-hole)",
    },
    // Fills.
    chip: "var(--ag-colorFillChip)",
    fill: {
        DEFAULT: "var(--ag-colorFill)",
        secondary: "var(--ag-colorFillSecondary)",
        tertiary: "var(--ag-colorFillTertiary)",
        quaternary: "var(--ag-colorFillQuaternary)",
    },
}
