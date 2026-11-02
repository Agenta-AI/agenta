import type {ReactNode} from "react"

/**
 * One row of the detail screen's field stack: a label, the control, and a muted line under it.
 *
 * The helper is part of the field, not an optional extra — every field here answers a question
 * the control itself cannot ("what does this agent bring?", "when does this run next?"). Only
 * the instruction field, whose composer explains itself, goes without one.
 */
export const AutomationField = ({
    label,
    helper,
    error,
    children,
}: {
    label: string
    helper?: ReactNode
    /**
     * What is wrong with this field right now. Takes the helper's line rather than adding one
     * under it: the field has one place to speak, and while it is wrong that is what it says.
     */
    error?: string
    children: ReactNode
}) => (
    <div className="flex flex-col gap-[7px]">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {children}
        {error ? (
            <span role="alert" className="text-[12px] leading-snug text-destructive">
                {error}
            </span>
        ) : helper ? (
            <span className="text-[12px] leading-snug text-muted-foreground">{helper}</span>
        ) : null}
    </div>
)
