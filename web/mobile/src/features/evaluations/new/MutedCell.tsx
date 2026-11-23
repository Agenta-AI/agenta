import type {ReactNode} from "react"

/** A quiet one-line table cell: a date, an author, a commit message. */
export const MutedCell = ({children}: {children: ReactNode}) => (
    <span className="block min-w-0 truncate text-label text-muted-foreground">{children}</span>
)
