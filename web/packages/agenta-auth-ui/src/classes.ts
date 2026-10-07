/**
 * The sign-in look as className on the shared primitives: one source, so every step's controls
 * stay the same size and color. Colors come from the theme (`--ag-*` and the shadcn tokens).
 */

/** The brand keycap on `Button`: the one primary action of a step. Classes stay literal for Tailwind's scan. */
export const KEYCAP_CLASS = [
    "h-11 w-full rounded-lg border-transparent px-4 text-sm font-medium",
    "bg-[linear-gradient(180deg,var(--ag-hero-action-bg)_0%,var(--ag-hero-action-hover-bg)_100%)]",
    "hover:bg-[linear-gradient(180deg,var(--ag-hero-action-bg)_0%,var(--ag-hero-action-hover-bg)_100%)] hover:brightness-[1.03]",
    "text-[color:var(--ag-hero-action-text)] hover:text-[color:var(--ag-hero-action-text)]",
    "shadow-[inset_0_2px_6.4px_rgba(255,255,255,0.8)] dark:shadow-[inset_0_2px_6.4px_rgba(255,255,255,0.3)] disabled:opacity-70",
].join(" ")

/** A full-width secondary action on `Button variant="outline"` (social sign-in, SSO). */
export const SURFACE_CLASS = "h-11 w-full rounded-lg px-4 text-sm font-medium"

/** A text field on `Input`, sized like the buttons beside it. */
export const FIELD_CLASS = "h-11 rounded-lg px-3 text-sm md:text-sm"

/** The line under a field that says what went wrong. */
export const ERROR_TEXT_CLASS = "auth-rise m-0 text-[13px] leading-5 text-error"

/** A quiet line under a field: a notice or a step's progress. */
export const STATUS_TEXT_CLASS =
    "auth-rise m-0 flex items-center gap-2 text-[13px] leading-5 text-muted-foreground"

/** A step heading and the line under it. */
export const HEADLINE_CLASS =
    "auth-headline m-0 text-[34px] font-semibold leading-10 tracking-[-0.02em] text-foreground"
export const SUBLINE_CLASS = "m-0 text-[15px] leading-[22px] text-muted-foreground text-pretty"
