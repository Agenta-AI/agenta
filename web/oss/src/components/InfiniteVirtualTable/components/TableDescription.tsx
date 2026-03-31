import type {ReactNode} from "react"

import {Typography} from "antd"
import clsx from "clsx"

export interface TableDescriptionProps {
    /** The description text or content */
    children: ReactNode
    /** Additional CSS class names */
    className?: string
    /** Maximum width constraint (default: "prose" for readable line length) */
    maxWidth?: "prose" | "full" | "none"
}

/**
 * A reusable description component for table headers.
 * Provides consistent styling and can be enhanced with additional functionality.
 *
 * @example
 * ```tsx
 * <TableDescription>
 *   Manage your testsets for evaluations.
 * </TableDescription>
 *
 * <TableDescription maxWidth="full">
 *   Specify column names similar to the Input parameters.
 *   A column with <strong>'correct_answer'</strong> name will be treated as a ground truth column.
 * </TableDescription>
 * ```
 */
const TableDescription = ({children, className, maxWidth = "prose"}: TableDescriptionProps) => {
    const maxWidthClass = {
        prose: "max-w-prose",
        full: "max-w-full",
        none: "",
    }[maxWidth]

    return (
        <Typography.Paragraph
            type="secondary"
            className={clsx(maxWidthClass, "line-clamp-2 h-10", className)}
            style={{marginBottom: 0}}
        >
            {children}
        </Typography.Paragraph>
    )
}

export default TableDescription
