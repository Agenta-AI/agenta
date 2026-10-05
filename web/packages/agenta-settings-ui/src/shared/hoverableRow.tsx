import type {ReactNode} from "react"

/** A ListTable `wrapRow` that fills the row on hover, for rows that do not open on click. */
export const hoverableRow = (_row: unknown, row: ReactNode) => (
    <div className="[&>*:hover]:bg-accent/60">{row}</div>
)
