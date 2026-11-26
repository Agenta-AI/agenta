/** One agent-picker row: a leading mark, a title with a meta line, and an action on the right. */
import type {MouseEvent, ReactNode} from "react"

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
    /** Extra classes on the row container (e.g. a membership tint). */
    className?: string
    /** Expanded rows below the title, such as a connection chooser. */
    expansion?: ReactNode
    /** Runs the row's action from a click anywhere on it, or Enter/Space on the focused row. */
    onClick?: () => void
    /** The accessible name of that action ("Add GitHub"). */
    actionLabel?: string
    /**
     * `center` (default) centres the logo and action on the text. `start` pins them to the top,
     * for a row whose text can grow (an expandable description) so they do not drift with it.
     */
    align?: "center" | "start"
    /** `canvas`: the agent panel's row (canvas F02 f4). Absent, the Settings page row. */
    variant?: "default" | "canvas"
}

// A click on a control inside the row belongs to that control, not to the row.
const INTERACTIVE = "button, a, input, label, [role='button'], [role='radio']"

export function CatalogListRow({
    leading,
    title,
    titleSuffix,
    children,
    action,
    highlighted,
    expansion,
    className,
    onClick,
    actionLabel,
    align = "center",
    variant = "default",
}: CatalogListRowProps) {
    const canvas = variant === "canvas"
    const handleClick = onClick
        ? (event: MouseEvent<HTMLDivElement>) => {
              // React bubbles a click out of a portal (a menu, a dialog) into this row too.
              if (!event.currentTarget.contains(event.target as Node)) return
              const hit = (event.target as HTMLElement).closest(INTERACTIVE)
              // The row is itself role=button, so a hit on the row is not a nested control.
              if (hit && hit !== event.currentTarget && event.currentTarget.contains(hit)) return
              onClick()
          }
        : undefined

    return (
        <div
            onClick={handleClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={onClick ? actionLabel : undefined}
            onKeyDown={
                onClick
                    ? (event) => {
                          if (event.target !== event.currentTarget) return
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          onClick()
                      }
                    : undefined
            }
            // -mx/px hangs the hover fill outside the alignment line; always 48 px tall (ROW-01).
            className={`group/row -mx-2 flex min-h-row-double flex-col justify-center rounded-md px-2 py-1.5 outline-none transition-colors focus-ring ${
                highlighted ? "bg-secondary" : ""
            } ${onClick ? "cursor-pointer" : ""} hover:bg-accent ${className ?? ""}`}
        >
            {/* 12 px from the 32 px Mark to its text (SPACE-04). */}
            <div className={`flex gap-3 ${align === "start" ? "items-start" : "items-center"}`}>
                {/* The two-line row's 32 px Mark (`mark-lg`), on the panel and on the page. */}
                {leading ? (
                    <span className="flex size-8 shrink-0 items-center justify-center">
                        {leading}
                    </span>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className={`flex items-center ${canvas ? "gap-1" : "gap-1.5"}`}>
                        <span className="truncate text-label text-foreground">{title}</span>
                        {titleSuffix}
                    </div>
                    {children}
                </div>
                {/* h-8: level with the logo box. */}
                {action ? <span className="flex h-8 shrink-0 items-center">{action}</span> : null}
            </div>
            {expansion}
        </div>
    )
}
