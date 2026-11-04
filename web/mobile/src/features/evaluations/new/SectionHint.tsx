import type {ReactNode} from "react"

/** A quiet line inside a section: a prompt to pick something first, or a note. */
export const SectionHint = ({children}: {children: ReactNode}) => (
    <p className="m-0 text-sm text-muted-foreground">{children}</p>
)
