import * as React from "react"

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import {Check, ChevronRight, Circle} from "lucide-react"

import {cn} from "./utils"

/**
 * DropdownMenu — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Chrome copied from SelectContent (antd's borderless overlay: bg-popover,
 * shadow-overlay, rounded-control-lg, font-portal, box-border); item geometry/states copied
 * from SelectItem (min-h-control, rounded-control-sm, px-3 py-1, text-field-md, hover bg-muted).
 *
 * antd → @agenta/ui mapping:
 *   <Dropdown menu={{items:[{key,label,icon,disabled,danger,type:'divider',children}]}}>
 *     → <DropdownMenu><DropdownMenuTrigger/><DropdownMenuContent>
 *         <DropdownMenuItem/> · <DropdownMenuSeparator/> (divider) ·
 *         <DropdownMenuSub><DropdownMenuSubTrigger/><DropdownMenuSubContent/></DropdownMenuSub> (children)
 *       </DropdownMenuContent></DropdownMenu>
 *   open→open · getPopupContainer→container · trigger→Radix defaults · danger→variant="destructive"
 */

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
                    // Chrome copied token-for-token from SelectContent: antd `.ant-dropdown-menu`
                    // is borderless (bg colorBgElevated), radius borderRadiusLG (rounded-control-lg),
                    // shadow boxShadowSecondary (shadow-overlay), padding 4px (p-1). font-portal: this
                    // portals to <body>, escaping the app font scope. box-border: preflight is off.
                    "relative z-50 box-border max-h-96 overflow-y-auto overflow-x-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-control-lg p-1",
                    // `.overflow-y-auto` matches the global scroll-fade rule (globals.css), whose
                    // scroll-driven animation never fires `animationend` — Radix Presence then
                    // waits forever and the closed content stays mounted, aria-hiding the page.
                    // `animate-none` outranks the `:where()` rule; no other animation exists here.
                    "animate-none",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    )
}

const itemBase = [
    "relative flex w-full cursor-pointer select-none items-center gap-2 outline-none",
    // antd `.ant-dropdown-menu-item` geometry (NOT SelectItem's): 30px tall = 5px×12px padding
    // + 20px line-height, min-height 0, radius 6px. py-input-y-ghost = 5px (reused 5px token).
    "box-border rounded-control-sm px-3 py-input-y-ghost text-field-md",
    // Hover = antd controlItemBgHover (bg-muted); disabled skin — matches SelectItem.
    "[&[data-highlighted]]:bg-muted",
    "data-[disabled]:pointer-events-none data-[disabled]:text-disabled",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "data-[inset]:pl-8",
]

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
                // antd danger item = colorError text (matches Select's aria-invalid text-error token).
                variant === "destructive" &&
                    "text-error [&[data-highlighted]]:bg-error-bg [&_svg]:text-error",
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
            className={cn(itemBase, "pl-8", className)}
            checked={checked}
            {...props}
        >
            <span className="absolute left-3 flex size-3 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="size-3 text-primary" />
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
            className={cn(itemBase, "pl-8", className)}
            {...props}
        >
            <span className="absolute left-3 flex size-3 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Circle className="size-2 fill-current text-primary" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
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
                "px-input-sm py-input-y-sm text-field-sm text-placeholder data-[inset]:pl-8",
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
    // antd `.ant-dropdown-menu-item-divider`: 1px colorSplit, `marginXXS 0`, inset by the menu's p-1.
    return (
        <DropdownMenuPrimitive.Separator
            data-slot="dropdown-menu-separator"
            className={cn("my-1 h-px bg-colorSplit", className)}
            {...props}
        />
    )
}

function DropdownMenuShortcut({className, ...props}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="dropdown-menu-shortcut"
            className={cn("ml-auto text-field-sm tracking-widest text-placeholder", className)}
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
            className={cn(itemBase, "data-[state=open]:bg-muted", className)}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto size-3 text-placeholder" />
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
                    // Same overlay chrome as DropdownMenuContent / SelectContent.
                    "relative z-50 box-border max-h-96 overflow-y-auto overflow-x-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-control-lg p-1",
                    // See DropdownMenuContent: the scroll-fade animation deadlocks Presence unmount.
                    "animate-none",
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
