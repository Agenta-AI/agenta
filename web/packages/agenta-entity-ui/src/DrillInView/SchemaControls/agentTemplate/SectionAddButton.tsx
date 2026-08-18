/**
 * SectionAddButton
 *
 * The compact "+" that sits in a config section header's `extra` slot (add a tool / MCP server /
 * skill / instruction file). Presentational: a ghost icon button with a tooltip, nothing else.
 *
 * `forwardRef` + prop spread so it can BE the trigger of a Popover/DropdownMenu (Radix `asChild`
 * injects `onClick`, `aria-expanded`, and a positioning ref) — the same contract `AddTextLink`
 * already carries for the empty-state links.
 *
 * Migrated from antd `Tooltip title` + `Button type="text" icon`. A disabled button swallows
 * pointer events, so the disabled case keeps antd's `<span>` wrapper as the tooltip trigger.
 */
import {forwardRef, type ButtonHTMLAttributes, type ReactNode} from "react"

import {Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

export interface SectionAddButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** Accessible name, and the tooltip copy unless `tooltip` overrides it. */
    label: string
    /** Tooltip copy when it should differ from the accessible name (e.g. a "coming soon" hint). */
    tooltip?: ReactNode
}

export const SectionAddButton = forwardRef<HTMLButtonElement, SectionAddButtonProps>(
    function SectionAddButton({label, tooltip, disabled, type = "button", ...rest}, ref) {
        const button = (
            <Button
                ref={ref}
                type={type}
                variant="ghost"
                size="icon"
                aria-label={label}
                disabled={disabled}
                {...rest}
            >
                <Plus size={16} />
            </Button>
        )
        return (
            <TooltipProvider>
                <Tooltip>
                    {/* A disabled <button> receives no pointer events, so the tooltip hangs off a
                        wrapper span — exactly what the antd markup did. */}
                    <TooltipTrigger asChild>
                        {disabled ? <span>{button}</span> : button}
                    </TooltipTrigger>
                    <TooltipContent>{tooltip ?? label}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    },
)

SectionAddButton.displayName = "SectionAddButton"
