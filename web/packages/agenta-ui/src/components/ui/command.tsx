import * as React from "react"

import {Command as CommandPrimitive} from "cmdk"
import {CheckIcon, SearchIcon} from "lucide-react"

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "./dialog"
import {cn} from "./utils"

/**
 * Command — shadcn's Nova command palette on `cmdk`, styled through the token bridge.
 *
 * A filtered list with keyboard navigation: `Command` > `CommandInput` + `CommandList` >
 * `CommandGroup` > `CommandItem`. `CommandDialog` wraps the same parts in a `Dialog` for a
 * ⌘K-style palette. Geometry follows Nova (a padded panel, a filled field, 8px rows in a
 * dialog); the highlight is `accent`, not Nova's `muted` — in dark, `--muted` equals the
 * panel's own background.
 */

function Command({className, ...props}: React.ComponentProps<typeof CommandPrimitive>) {
    return (
        <CommandPrimitive
            data-slot="command"
            className={cn(
                "flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground",
                className,
            )}
            {...props}
        />
    )
}

function CommandDialog({
    title = "Command Palette",
    description = "Search for a command to run...",
    children,
    className,
    showCloseButton = false,
    shouldFilter,
    ...props
}: React.ComponentProps<typeof Dialog> & {
    /** Screen-reader name for the dialog. */
    title?: string
    /** Screen-reader description for the dialog. */
    description?: string
    className?: string
    showCloseButton?: boolean
    /** cmdk's own fuzzy filter; off when the host already matched (server search). */
    shouldFilter?: boolean
}) {
    return (
        <Dialog {...props}>
            <DialogHeader className="sr-only">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <DialogContent
                className={cn("overflow-hidden rounded-xl p-0", className)}
                showCloseButton={showCloseButton}
                // The search field takes focus on open, whatever else is focusable in the list.
                onOpenAutoFocus={(event) => {
                    const input = (
                        event.currentTarget as HTMLElement | null
                    )?.querySelector<HTMLElement>("[cmdk-input]")
                    if (!input) return
                    event.preventDefault()
                    input.focus()
                }}
            >
                <Command shouldFilter={shouldFilter}>{children}</Command>
            </DialogContent>
        </Dialog>
    )
}

function CommandInput({className, ...props}: React.ComponentProps<typeof CommandPrimitive.Input>) {
    // Nova's field: a low, filled input group sitting in the panel's own gutter.
    return (
        <div data-slot="command-input-wrapper" className="p-1 pb-0">
            <div className="flex h-8 items-center gap-2 rounded-lg bg-colorFillQuaternary pl-2 pr-3 ring-1 ring-inset ring-border transition-[box-shadow] focus-within:ring-ring focus-within:shadow-[0_0_0_3px_var(--ag-controlOutline)]">
                <SearchIcon className="size-4 shrink-0 opacity-50" />
                <CommandPrimitive.Input
                    data-slot="command-input"
                    className={cn(
                        "box-border h-full w-full min-w-0 border-0 bg-transparent p-0 font-[inherit] text-sm text-foreground outline-none placeholder:text-placeholder disabled:cursor-not-allowed disabled:opacity-50",
                        className,
                    )}
                    {...props}
                />
            </div>
        </div>
    )
}

function CommandList({className, ...props}: React.ComponentProps<typeof CommandPrimitive.List>) {
    return (
        <CommandPrimitive.List
            data-slot="command-list"
            className={cn(
                "max-h-72 scroll-py-1 overflow-y-auto overflow-x-hidden outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                className,
            )}
            {...props}
        />
    )
}

function CommandEmpty({className, ...props}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
    return (
        <CommandPrimitive.Empty
            data-slot="command-empty"
            className={cn("py-6 text-center text-sm", className)}
            {...props}
        />
    )
}

function CommandGroup({className, ...props}: React.ComponentProps<typeof CommandPrimitive.Group>) {
    return (
        <CommandPrimitive.Group
            data-slot="command-group"
            className={cn(
                "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
                className,
            )}
            {...props}
        />
    )
}

function CommandSeparator({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
    return (
        <CommandPrimitive.Separator
            data-slot="command-separator"
            className={cn("-mx-1 h-px bg-border", className)}
            {...props}
        />
    )
}

function CommandItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
    return (
        <CommandPrimitive.Item
            data-slot="command-item"
            className={cn(
                "group/command-item relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                "[[data-slot=dialog-content]_&]:rounded-lg",
                "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
                "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            {children}
            {/* A picked row's check, as in a combobox; hidden where a shortcut owns the slot. */}
            <CheckIcon className="ml-auto opacity-0 group-has-[[data-slot=command-shortcut]]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
        </CommandPrimitive.Item>
    )
}

function CommandShortcut({className, ...props}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="command-shortcut"
            className={cn(
                "ml-auto text-xs tracking-widest text-muted-foreground group-data-[selected=true]/command-item:text-accent-foreground",
                className,
            )}
            {...props}
        />
    )
}

export {
    Command,
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
    CommandSeparator,
}
