import type {OwnerKind} from "@agenta/shared/types"

/** Canvas F02 f5 field labels: 12/16/500 in the secondary text color. */
export const CANVAS_FIELD_LABEL =
    "[&_[data-slot=field-label]]:text-meta [&_[data-slot=field-label]]:text-muted-foreground"

/** Who owns a new connection: the person ("Only me") or the project ("Everyone"). */
export type ConnectionOwner = Exclude<OwnerKind, "organization">
