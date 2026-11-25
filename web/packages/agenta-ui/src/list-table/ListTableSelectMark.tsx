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
 * hover and focus, while anything is selected, and always on touch; without it, the Mark as is.
 */
export const ListTableSelectMark = ({children}: {children: ReactNode}) => {
    const select = useContext(ListTableRowSelectContext)
    if (!select) return <>{children}</>
    const {checked, selecting, label, onToggle} = select
    const shown = checked || selecting
    return (
        // The row opens on a click and on Enter; the check must not.
        <span
            className="relative inline-flex shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            {children}
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
                              "bg-selected group-hover:opacity-100 pointer-coarse:opacity-100",
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
        </span>
    )
}
