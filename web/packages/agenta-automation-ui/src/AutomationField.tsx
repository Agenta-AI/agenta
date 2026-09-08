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
    children,
}: {
    label: string
    helper?: ReactNode
    children: ReactNode
}) => (
    <div className="flex flex-col gap-[7px]">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {children}
        {helper ? (
            <span className="text-[12px] leading-snug text-muted-foreground">{helper}</span>
        ) : null}
    </div>
)
