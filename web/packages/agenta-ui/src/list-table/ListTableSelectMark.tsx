import {createContext, useContext} from "react"
import type {ReactNode} from "react"

import {CheckIcon} from "@phosphor-icons/react"

import {cn} from "../components/ui/utils"

/** One row's selection, handed by `ListTable` to the Mark under `selection.markAsCheckbox`. */
export interface ListTableRowSelect {
    checked: boolean
    /** Some row is selected, so every Mark shows its check. */
    selecting: boolean
    label: string
    onToggle: () => void
}

export const ListTableRowSelectContext = createContext<ListTableRowSelect | null>(null)

/**
 * Wraps a row's or a card's Mark. Under `selection.markAsCheckbox` the Mark turns into a check on
 * hover and focus and while anything is selected; on touch, a small check sits on its corner until
 * then. Without it, the Mark as is. `dim` fades the Mark only (an archived row), never the check.
 */
export const ListTableSelectMark = ({
    children,
    dim = false,
}: {
    children: ReactNode
    dim?: boolean
}) => {
    const select = useContext(ListTableRowSelectContext)
    const mark = dim ? <span className="inline-flex opacity-60">{children}</span> : children
    if (!select) return <>{mark}</>
    const {checked, selecting, label, onToggle} = select
    const shown = checked || selecting
    return (
        // The row opens on a click and on Enter; the check must not.
        <span
            className="relative inline-flex shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            {mark}
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                aria-label={label}
                className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-md opacity-0"
            />
            <span
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-0 flex items-center justify-center rounded-md",
                    "transition-opacity duration-[var(--duration-fast)] ease-out motion-reduce:transition-none",
                    "peer-focus-visible:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-[var(--ring)]",
                    checked
                        ? "bg-foreground text-background opacity-100"
                        : cn(
                              "bg-selected pointer-fine:group-hover:opacity-100",
                              shown ? "opacity-100" : "opacity-0",
                          ),
                )}
            >
                {checked ? (
                    <CheckIcon size={16} weight="bold" />
                ) : (
                    <span className="box-border size-control-check rounded-control-check border border-solid border-border-strong bg-background" />
                )}
            </span>
            {/* Touch has no hover: the Mark stays, with a small check on its corner. */}
            {shown ? null : (
                <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-1 -right-1 hidden size-3.5 rounded-control-check border border-solid border-border-strong bg-background pointer-coarse:block"
                />
            )}
        </span>
    )
}
