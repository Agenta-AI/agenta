import {memo} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"

import {FlyoutChildren} from "./NavMenu"

/**
 * A nav group rendered as a single icon button rather than a labelled row.
 *
 * The rail's Help & Docs entry sits beside the project switcher, where a full-width row would
 * cost the switcher its name. It draws the same flyout the collapsed rail draws, so the two
 * paths cannot describe the same menu differently.
 */
const SidebarIconMenu = ({item}: {item: SidebarConfig}) => (
    <DropdownMenu>
        <TooltipProvider delayDuration={600}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={item.title as string}
                            // [font-family:inherit]: preflight is off, so a bare <button>
                            // renders Arial while the rows around it render Inter.
                            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
                        >
                            {item.icon}
                        </button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">{item.title}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
        {/* Opens upward from the rail's last row, and rightward from the trigger's left edge:
            the panel is wider than a narrow rail, so anchoring it to the trigger's RIGHT edge
            ran it off the left of the screen. It overhangs the content area instead, which is
            empty space beside a nav — the same call the sessions filter makes. */}
        <DropdownMenuContent
            side="top"
            align="start"
            className="max-h-[min(70vh,560px)] w-[228px] overflow-y-auto"
        >
            <FlyoutChildren items={item.submenu ?? []} selectedKeys={[]} />
        </DropdownMenuContent>
    </DropdownMenu>
)

export default memo(SidebarIconMenu)
