import * as React from "react"

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"

import {cn} from "./utils"

/**
 * ContextMenu — the right-click counterpart of DropdownMenu, on the Radix primitive. Chrome and
 * item geometry are copied token-for-token from dropdown-menu.tsx so a context menu and a click
 * menu over the same rows are indistinguishable.
 *
 * antd → @agenta/ui mapping:
 *   <Dropdown menu={{items}} trigger={["contextMenu"]}><node/></Dropdown>
 *     → <ContextMenu><ContextMenuTrigger asChild><node/></ContextMenuTrigger>
 *       <ContextMenuContent><ContextMenuItem/> · <ContextMenuSeparator/></ContextMenuContent>
 *       </ContextMenu>
 */

function ContextMenu(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger(props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
    return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({
    className,
    container,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline. */
    container?: HTMLElement | null
}) {
    return (
        <ContextMenuPrimitive.Portal container={container}>
            <ContextMenuPrimitive.Content
                data-slot="context-menu-content"
                className={cn(
                    // Chrome copied from DropdownMenuContent (antd `.ant-dropdown-menu`).
                    "relative z-50 box-border max-h-96 overflow-y-auto overflow-x-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-control-lg p-1",
                    // Same scroll-timeline opt-out as DropdownMenuContent: without it a host
                    // scrollbar-fade rule keeps the closed menu mounted and painted.
                    "[animation-name:none] [animation-timeline:auto]",
                    className,
                )}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    )
}

const itemBase = [
    "relative flex w-full cursor-pointer select-none items-center gap-2 outline-none",
    "box-border rounded-control-sm px-3 py-input-y-ghost text-field-md",
    "[&[data-highlighted]]:bg-muted",
    "data-[disabled]:pointer-events-none data-[disabled]:text-disabled",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
]

function ContextMenuItem({
    className,
    variant = "default",
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
    variant?: "default" | "destructive"
}) {
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-variant={variant}
            className={cn(
                itemBase,
                variant === "destructive" &&
                    "text-error [&[data-highlighted]]:bg-error-bg [&_svg]:text-error",
                className,
            )}
            {...props}
        />
    )
}

function ContextMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
    return (
        <ContextMenuPrimitive.Separator
            data-slot="context-menu-separator"
            className={cn("mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    )
}

export {ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator}
