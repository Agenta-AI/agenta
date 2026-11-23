/** The sign-in look as classNames on the shared primitives, on theme tokens. */

/** The brand keycap on `Button`: the one primary action of a step. Classes stay literal for Tailwind's scan. */
export const KEYCAP_CLASS = [
    "h-control-lg w-full rounded-md border-transparent px-4",
    "bg-brand hover:bg-brand-hover",
    "text-brand-foreground hover:text-brand-foreground disabled:opacity-70",
].join(" ")

/** A full-width secondary action on `Button variant="outline"` (social sign-in, SSO). */
export const SURFACE_CLASS = "h-control-lg w-full rounded-md px-4"

/** A text field on `Input`, sized like the buttons beside it. */
export const FIELD_CLASS = "h-control-lg rounded-md px-3"

/** The line under a field that says what went wrong. */
export const ERROR_TEXT_CLASS = "auth-rise m-0 text-label leading-5 text-destructive"

/** A quiet line under a field: a notice or a step's progress. */
export const STATUS_TEXT_CLASS =
    "auth-rise m-0 flex items-center gap-2 text-label leading-5 text-muted-foreground"

/** A step heading and the line under it. */
export const HEADLINE_CLASS =
    "auth-headline m-0 text-heading text-foreground"
export const SUBLINE_CLASS = "m-0 text-body text-muted-foreground text-pretty"
