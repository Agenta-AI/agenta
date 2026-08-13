/** The `?` marker: an explanation behind a hover/focus tooltip, next to whatever it explains. */
import type {ReactNode} from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"

export function HelpTip({
    label,
    children,
    side = "right",
}: {
    /** Names the control this explains; also the tooltip's heading. */
    label: string
    children: ReactNode
    side?: "top" | "right" | "bottom" | "left"
}) {
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={`About ${label}`}
                        className="flex size-[14px] shrink-0 cursor-help items-center justify-center rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent text-[10px] font-normal leading-none text-colorTextDescription outline-none hover:border-[var(--ag-colorTextTertiary)] hover:text-colorTextSecondary focus-visible:border-[var(--ag-colorPrimary)] focus-visible:text-colorTextSecondary focus-visible:shadow-[0_0_0_2px_var(--ag-controlOutline)]"
                    >
                        ?
                    </button>
                </TooltipTrigger>
                <TooltipContent side={side} className="max-w-[320px]">
                    <span className="mb-0.5 block font-medium">{label}</span>
                    <span className="block font-normal leading-snug">{children}</span>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
