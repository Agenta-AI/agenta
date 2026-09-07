import type {ReactNode} from "react"

/**
 * One row of the detail screen's field stack: a label, the control, and a muted line under it.
 *
 * The helper is part of the field, not an optional extra — every field here answers a question
 * the control itself cannot ("what does this agent bring?", "when does this run next?").
 */
export const AutomationField = ({
    label,
    helper,
    children,
}: {
    label: string
    helper: ReactNode
    children: ReactNode
}) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-foreground text-xs font-medium">{label}</span>
        {children}
        <span className="text-muted-foreground text-xs leading-snug">{helper}</span>
    </div>
)
