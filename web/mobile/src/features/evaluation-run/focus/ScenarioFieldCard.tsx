import type {ReactNode} from "react"

/** A labelled value in the drawer. */
export const ScenarioFieldCard = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-solid border-border bg-card px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {children}
    </div>
)
