import type {ReactNode} from "react"

/** Labelled form row for the settings sheets — label, control, optional hint under it. */
export const Field = ({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: ReactNode
}) => (
    <label className="flex flex-col gap-1.5">
        <span className="text-label text-foreground">{label}</span>
        {children}
        {hint ? <span className="text-meta text-muted-foreground">{hint}</span> : null}
    </label>
)
