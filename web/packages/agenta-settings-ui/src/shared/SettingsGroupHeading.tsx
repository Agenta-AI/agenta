import type {ReactNode} from "react"

import {cn} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"

const HEADING = "m-0 text-[13px] font-medium leading-[18px] text-muted-foreground"

const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

const Count = ({count}: {count: number | null}) =>
    count === null ? null : (
        <span className="text-[13px] font-normal text-muted-foreground/60">{count}</span>
    )

export interface SettingsGroupHeadingProps {
    /** A word, or a node such as the project switch. A folding heading takes text. */
    label: ReactNode
    /** Beside the label; `null` hides it. */
    count: number | null
    /** With `onToggle`, the heading folds its group away. */
    collapsed?: boolean
    onToggle?: () => void
    /** Right of the heading, e.g. "Show all". */
    action?: ReactNode
}

/** A Settings group's heading: the label, its count, and the fold caret when it folds. */
export const SettingsGroupHeading = ({
    label,
    count,
    collapsed,
    onToggle,
    action,
}: SettingsGroupHeadingProps) => (
    <div className="flex min-h-6 items-center gap-1.5">
        {onToggle ? (
            <h2 className={HEADING}>
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={onToggle}
                    className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-foreground",
                        FOCUS_RING,
                    )}
                >
                    {label}
                    <Count count={count} />
                    <CaretRight
                        size={12}
                        className={cn("transition-transform", !collapsed && "rotate-90")}
                    />
                </button>
            </h2>
        ) : (
            <>
                <h2 className={cn(HEADING, "flex min-w-0 items-center")}>{label}</h2>
                <Count count={count} />
            </>
        )}
        {action ? <div className="ml-auto flex">{action}</div> : null}
    </div>
)
