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
 * Wraps a row's or a card's Mark. Under `selection.markAsCheckbox` the Mark turns into a check when
 * the pointer is on the Mark itself, on focus and while anything is selected; on touch a tap on the
 * Mark selects. Without it, the Mark as is. `dim` fades the Mark only (an archived row), never the check.
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
                    // The `focus-ring` look (FORM-02), drawn here because the focused input is invisible.
                    "peer-focus-visible:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-0 peer-focus-visible:outline-[var(--ring)] peer-focus-visible:shadow-[inset_0_0_0_1px_var(--foreground)]",
                    checked
                        ? "bg-foreground text-background opacity-100"
                        : cn(
                              "bg-selected pointer-fine:peer-hover:opacity-100",
                              shown ? "opacity-100" : "opacity-0",
                          ),
                )}
            >
                {/* Unchecked, a quiet check icon says "click to select"; checked, it fills. */}
                <CheckIcon
                    size={16}
                    weight={checked ? "bold" : "regular"}
                    className={checked ? undefined : "text-muted-foreground"}
                />
            </span>
        </span>
    )
}
