import type {ReactNode} from "react"

/** A neutral toolbar action for a message row (copy, retry, rewind, ...). Skins map this to
 * their own markup — this type carries no rendering assumptions. */
export interface MessageAction {
    key: string
    label: string
    icon?: ReactNode
    onClick: () => void
}
