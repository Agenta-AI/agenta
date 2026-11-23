/** The info marker: an explanation behind a hover/focus tooltip, next to whatever it explains. */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import drawerSharedCatalog from "@agenta/i18n/catalogs/entityUi.drawerShared"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

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
    const t = useT(drawerSharedCatalog)
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={t("entityUi.drawerShared.about", {label})}
                        className="inline-flex shrink-0 cursor-help items-center justify-center rounded-sm border-0 bg-transparent p-0 leading-none text-muted-foreground outline-none hover:text-muted-foreground focus-visible:text-muted-foreground focus-ring"
                    >
                        <Info className="size-3.5" aria-hidden="true" />
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
