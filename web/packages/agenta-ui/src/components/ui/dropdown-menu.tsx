import * as React from "react"

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import {CaretRightIcon, CheckIcon} from "@phosphor-icons/react"

import {MENU_ITEM, MENU_ITEM_INSET} from "./menu-item"
import {cn} from "./utils"

/**
 * DropdownMenu — the shadcn dropdown menu on Radix, styled through the token bridge.
 * antd Dropdown mapping: getPopupContainer→container, danger→variant="destructive", divider→Separator.
 */

// The global scroll-fade animation never fires `animationend`, so a closed menu would stay
// mounted; killing the name and resetting the timeline releases it.
const NO_SCROLL_TIMELINE = "[animation-name:none] [animation-timeline:auto]"

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
    return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal(props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
    return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
    return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
    return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuRadioGroup(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
    return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
    return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuContent({
    className,
    sideOffset = 4,
    container,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline. */
    container?: HTMLElement | null
}) {
    return (
        <DropdownMenuPrimitive.Portal container={container}>
            <DropdownMenuPrimitive.Content
                data-slot="dropdown-menu-content"
                sideOffset={sideOffset}
                className={cn(
                    // font-portal: portalled to <body>, outside the app font scope; box-border: preflight off.
                    "relative z-50 box-border min-w-32 max-h-96 overflow-y-auto overflow-x-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-lg p-1",
                    NO_SCROLL_TIMELINE,
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    )
}

const itemBase = [MENU_ITEM, `data-[inset]:${MENU_ITEM_INSET}`]

function DropdownMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    variant?: "default" | "destructive"
}) {
    return (
        <DropdownMenuPrimitive.Item
            data-slot="dropdown-menu-item"
            data-inset={inset ? "" : undefined}
            data-variant={variant}
            className={cn(
                itemBase,
                // Error text on a 10% error tint when highlighted.
                variant === "destructive" &&
                    "text-destructive [&[data-highlighted]]:bg-destructive/10 [&[data-highlighted]]:text-destructive [&_svg]:text-destructive",
                className,
            )}
            {...props}
        />
    )
}

function DropdownMenuCheckboxItem({
    className,
    children,
    checked,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
    return (
        <DropdownMenuPrimitive.CheckboxItem
            data-slot="dropdown-menu-checkbox-item"
            className={cn(itemBase, MENU_ITEM_INSET, className)}
            checked={checked}
            {...props}
        >
            <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <CheckIcon className="size-3.5" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.CheckboxItem>
    )
}

function DropdownMenuRadioItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
    return (
        <DropdownMenuPrimitive.RadioItem
            data-slot="dropdown-menu-radio-item"
            className={cn(itemBase, className)}
            {...props}
        >
            <span className="min-w-0 flex-1">{children}</span>
            {/* One pick: a check on the right, as Select marks it; the slot keeps labels still. */}
            <span className="pointer-events-none flex size-4 shrink-0 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <CheckIcon className="size-3.5" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
        </DropdownMenuPrimitive.RadioItem>
    )
}

function DropdownMenuLabel({
    className,
    inset,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {inset?: boolean}) {
    return (
        <DropdownMenuPrimitive.Label
            data-slot="dropdown-menu-label"
            data-inset={inset ? "" : undefined}
            className={cn(
                "px-1.5 py-1 text-meta font-medium text-muted-foreground data-[inset]:pl-7",
                className,
            )}
            {...props}
        />
    )
}

function DropdownMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    // Full-bleed hairline (-mx-1 undoes the panel's p-1).
    return (
        <DropdownMenuPrimitive.Separator
            data-slot="dropdown-menu-separator"
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    )
}

function DropdownMenuShortcut({className, ...props}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="dropdown-menu-shortcut"
            className={cn(
                "ml-auto text-caption tracking-widest text-muted-foreground group-[[data-highlighted]]/dropdown-menu-item:text-accent-foreground",
                className,
            )}
            {...props}
        />
    )
}

function DropdownMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {inset?: boolean}) {
    return (
        <DropdownMenuPrimitive.SubTrigger
            data-slot="dropdown-menu-sub-trigger"
            data-inset={inset ? "" : undefined}
            className={cn(
                itemBase,
                "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                className,
            )}
            {...props}
        >
            {children}
            <CaretRightIcon className="ml-auto size-4" />
        </DropdownMenuPrimitive.SubTrigger>
    )
}

function DropdownMenuSubContent({
    className,
    container,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent> & {
    /** Portal target. Defaults to document.body; pass an element to render inline. */
    container?: HTMLElement | null
}) {
    return (
        <DropdownMenuPrimitive.Portal container={container}>
            <DropdownMenuPrimitive.SubContent
                data-slot="dropdown-menu-sub-content"
                className={cn(
                    // Same panel as DropdownMenuContent.
                    "relative z-50 box-border min-w-32 max-h-96 overflow-y-auto overflow-x-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-lg p-1",
                    NO_SCROLL_TIMELINE,
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    )
}

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal,
}
