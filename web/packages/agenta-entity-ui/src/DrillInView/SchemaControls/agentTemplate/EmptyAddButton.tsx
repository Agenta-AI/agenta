/**
 * EmptyAddButton
 *
 * An empty config section's way in: a full-width, dashed, quiet button that opens the same add
 * flow as the section header's "+". `forwardRef` + prop spread so it can be a menu trigger.
 */
import {forwardRef, type ButtonHTMLAttributes} from "react"

import {cn} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"

export interface EmptyAddButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** The button's text ("Add MCP server"). */
    label: string
}

export const EmptyAddButton = forwardRef<HTMLButtonElement, EmptyAddButtonProps>(
    function EmptyAddButton({label, type = "button", className, ...rest}, ref) {
        return (
            <button
                ref={ref}
                type={type}
                className={cn(
                    "box-border flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-colorBorderSecondary bg-transparent text-xs text-colorTextTertiary transition-colors",
                    "hover:border-colorBorder hover:bg-[var(--ag-colorFillQuaternary)] hover:text-colorText aria-expanded:border-colorBorder aria-expanded:text-colorText",
                    "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]",
                    className,
                )}
                {...rest}
            >
                <Plus size={12} aria-hidden />
                {label}
            </button>
        )
    },
)
