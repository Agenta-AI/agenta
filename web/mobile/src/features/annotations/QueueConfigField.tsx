import type {ReactNode} from "react"

/** A read-only label and value pair of the Configuration tab. */
export const QueueConfigField = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
)
