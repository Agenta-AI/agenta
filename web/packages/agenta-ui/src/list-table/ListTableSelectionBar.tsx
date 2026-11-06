import type {ReactNode} from "react"

import {Button} from "../components/ui/button"

/**
 * What the header row shows while rows are selected: how many, a way to clear them, and the
 * consumer's bulk actions. It takes the place of the column names, so selecting moves nothing.
 */
export const ListTableSelectionBar = ({
    count,
    onClear,
    actions,
}: {
    count: number
    onClear: () => void
    actions?: ReactNode
}) => (
    <span
        role="status"
        className="col-[2/-1] flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground"
    >
        <span className="shrink-0">{count} selected</span>
        <Button type="button" size="xs" variant="ghost" onClick={onClear}>
            Clear
        </Button>
        {actions ? (
            <span className="ml-auto flex shrink-0 items-center gap-2">{actions}</span>
        ) : null}
    </span>
)
