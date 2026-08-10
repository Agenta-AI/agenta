/**
 * RequiredTitle — the accordion-section title marker shared by the schedule and
 * subscription trigger drawers (both render identical required-field headers).
 */
import {type ReactNode} from "react"

// Section title with a trailing required marker (icon → text → required).
export function RequiredTitle({children}: {children: ReactNode}) {
    return (
        <>
            {children}
            <span className="ml-1 text-[var(--ag-colorError)]">*</span>
        </>
    )
}
