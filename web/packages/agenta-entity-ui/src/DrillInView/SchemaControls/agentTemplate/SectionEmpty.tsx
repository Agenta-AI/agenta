import {createContext, useContext, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"
import {Button, EmptyState} from "@agenta/ui/ui"

import {usePhoneSections} from "./phoneSections"

/** The first action of an empty section ("Add subagent"), set by the panel's section list. */
export interface SectionEmptyAction {
    label: string
    onClick: () => void
}

export const SectionEmptyActionContext = createContext<SectionEmptyAction | null>(null)

/**
 * The one empty state of an Agent tab section (STATE-01): a compact dashed box, one row tall,
 * with one quiet line. In the panel's section card it is a plain line with the section's first
 * action at the row end; elsewhere the section header's control is the way to add.
 */
export const SectionEmpty = ({
    children,
    className,
    actionDisabled,
    note,
}: {
    children: ReactNode
    className?: string
    /** The section's add rule forbids the action now (a secret on an unsaved agent). */
    actionDisabled?: boolean
    /** Why it matters, under the line on a phone screen. */
    note?: string
}) => {
    const action = useContext(SectionEmptyActionContext)
    const phone = usePhoneSections() !== null
    // A phone screen: the empty state, its one action is the screen's bottom button (STATE-01).
    if (phone) {
        return (
            <EmptyState image="simple" title={children} description={note} className={className} />
        )
    }
    return (
        <div
            className={cn(
                "box-border flex min-h-row-single items-center justify-center gap-2 rounded-md px-3 py-1.5",
                "border border-dashed border-border-muted text-center text-meta text-muted-foreground",
                // In the panel's section card: one quiet line on the title's text line, no box (SURF-01).
                "in-data-section-card:justify-start in-data-section-card:border-transparent in-data-section-card:py-1 in-data-section-card:pl-11 in-data-section-card:pr-2 in-data-section-card:text-left",
                className,
            )}
        >
            <span className={action ? "min-w-0 flex-1" : undefined}>{children}</span>
            {action ? (
                <Button
                    variant="secondary"
                    size="xs"
                    className="shrink-0"
                    disabled={actionDisabled}
                    onClick={action.onClick}
                >
                    {action.label}
                </Button>
            ) : null}
        </div>
    )
}
