import {type ButtonHTMLAttributes, forwardRef} from "react"

/**
 * The inline "add a …" accent text-link used by every config-section empty state ("No tools yet —
 * add a tool"). forwardRef + prop spread so it can be the trigger of a Popover/Dropdown (which
 * inject `onClick` and a positioning ref).
 */
export const AddTextLink = forwardRef<
    HTMLButtonElement,
    {label: string} & ButtonHTMLAttributes<HTMLButtonElement>
>(function AddTextLink({label, type = "button", ...rest}, ref) {
    return (
        <button
            ref={ref}
            type={type}
            {...rest}
            className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-c-1677FF,#1677ff)] hover:underline"
        >
            {label}
        </button>
    )
})

AddTextLink.displayName = "AddTextLink"
