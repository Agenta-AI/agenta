/** One agent-picker row: a leading mark, a title with a meta line, and an action on the right. */
import type {ReactNode} from "react"

export interface CatalogListRowProps {
    /** Logo, icon chip, or anything else that identifies the item. */
    leading?: ReactNode
    title: ReactNode
    /** Tags and markers on the title line, after the name. */
    titleSuffix?: ReactNode
    /** Description, meta line, or both. Sits under the title. */
    children?: ReactNode
    /** The row's action, right-aligned and vertically centred with the title line. */
    action?: ReactNode
    /** Tints the row, for the open state of an expandable description. */
    highlighted?: boolean
    /** Expanded rows below the title, such as a connection chooser. */
    expansion?: ReactNode
}

export function CatalogListRow({
    leading,
    title,
    titleSuffix,
    children,
    action,
    highlighted,
    expansion,
}: CatalogListRowProps) {
    return (
        <div
            className={`border-0 border-t border-solid border-[var(--ag-colorSplit)] px-3 py-2.5 first:border-t-0 ${
                highlighted ? "bg-[var(--ag-colorFillQuaternary)]" : ""
            }`}
        >
            {/* items-start, not items-center: the action must stay put while the row grows. */}
            <div className="flex items-start gap-2.5">
                {leading ? <span className="mt-px flex shrink-0">{leading}</span> : null}
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* min-h matches a small Button, so the title line stays level with the action. */}
                    <div className="flex min-h-6 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{title}</span>
                        {titleSuffix}
                    </div>
                    {children}
                </div>
                {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
            </div>
            {expansion}
        </div>
    )
}
