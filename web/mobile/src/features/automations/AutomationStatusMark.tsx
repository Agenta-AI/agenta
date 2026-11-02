import {AUTOMATION_STATUS_LABEL, type AutomationStatus} from "@agenta/automation-ui"

/**
 * The status colour. A bare dot and a coloured word, never a pill: the status column is read
 * down, and four pills in a column read as four buttons. Stopped is a choice, so it reads as
 * inert; red, not the accent, is reserved for a fault to fix.
 */
const STATUS_COLOR: Record<AutomationStatus, {dot: string; text: string}> = {
    working: {dot: "bg-success", text: "text-success"},
    paused: {dot: "bg-muted-foreground", text: "text-muted-foreground"},
    attention: {dot: "bg-destructive", text: "text-destructive"},
}

/** Whether an automation is working — the same dot and word in a row's cell and a card's line. */
export const AutomationStatusMark = ({status}: {status: AutomationStatus}) => {
    const color = STATUS_COLOR[status]
    return (
        <span className="flex min-w-0 items-center gap-[7px]">
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${color.dot}`} />
            <span className={`text-[13px] ${color.text}`}>{AUTOMATION_STATUS_LABEL[status]}</span>
        </span>
    )
}
