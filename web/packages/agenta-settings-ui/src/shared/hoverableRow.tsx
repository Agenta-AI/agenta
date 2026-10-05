import type {ReactNode} from "react"

/**
 * A `ListTable` `wrapRow` that fills the row on hover. ListTable hovers only rows that open;
 * a Settings row with just a kebab still reads as one line under the pointer.
 */
export const hoverableRow = (_row: unknown, row: ReactNode) => (
    <div className="[&>*:hover]:bg-accent/60">{row}</div>
)
