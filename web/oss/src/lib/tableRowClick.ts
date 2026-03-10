import type {MouseEvent} from "react"

/**
 * Determines if a row click event should be ignored because it originated from
 * an interactive element within the row.
 *
 * This helper prevents accidental row navigation when users interact with:
 * - Buttons (including dropdown triggers)
 * - Links
 * - Checkboxes and radio buttons
 * - Select dropdowns
 * - Input fields and textareas
 *
 * @param event - The mouse click event from the table row
 * @returns `true` if the click should be ignored (don't trigger row action), `false` otherwise
 *
 * @example
 * ```tsx
 * <Table
 *   onRow={(record) => ({
 *     onClick: (event) => {
 *       if (shouldIgnoreRowClick(event)) return
 *       navigateToRecord(record)
 *     }
 *   })}
 * />
 * ```
 */
export const shouldIgnoreRowClick = (event: MouseEvent<HTMLElement>): boolean => {
    const target = event.target as HTMLElement

    // Check if clicking on interactive elements
    if (
        target.closest("button") ||
        target.closest("a") ||
        target.closest(".ant-dropdown-trigger") ||
        target.closest(".ant-checkbox-wrapper") ||
        target.closest(".ant-select") ||
        target.closest("input") ||
        target.closest("textarea")
    ) {
        return true
    }

    return false
}
