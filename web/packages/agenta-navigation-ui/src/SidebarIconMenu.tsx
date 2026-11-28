import {memo} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"

import {FlyoutChildren} from "./NavMenu"

/**
 * A nav group as one icon button (Help & Docs beside the project switcher), drawing the same
 * flyout the collapsed rail draws.
 */
const SidebarIconMenu = ({item}: {item: SidebarConfig}) => (
    <DropdownMenu>
        <SimpleTooltip title={item.title} side="top">
            {/* A span between the tooltip and the menu trigger, so the two Radix triggers do not nest. */}
            <span className="inline-flex">
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={item.title as string}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        {item.icon}
                    </Button>
                </DropdownMenuTrigger>
            </span>
        </SimpleTooltip>
        {/* Opens upward and rightward; popover-md fits the update row label ("New minor version: v0.131.0") in every language. */}
        <DropdownMenuContent
            side="top"
            align="start"
            className="max-h-[min(70dvh,560px)] w-popover-md overflow-y-auto"
        >
            <FlyoutChildren items={item.submenu ?? []} selectedKeys={[]} />
        </DropdownMenuContent>
    </DropdownMenu>
)

export default memo(SidebarIconMenu)
