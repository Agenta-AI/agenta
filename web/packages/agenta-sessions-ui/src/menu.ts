import type {ReactNode} from "react"

/**
 * The neutral menu contract for a session row's actions.
 *
 * The app owns the verbs (they must match its other session surfaces); the package owns the
 * rendering. Neutral rather than antd's `MenuProps["items"]` so the same items drive a Radix
 * menu here and whatever a touch surface renders later.
 */
export type SessionMenuEntry =
    | {key: string; label: ReactNode; icon?: ReactNode; danger?: boolean; disabled?: boolean}
    | {type: "divider"}

export const isMenuDivider = (entry: SessionMenuEntry): entry is {type: "divider"} =>
    "type" in entry
