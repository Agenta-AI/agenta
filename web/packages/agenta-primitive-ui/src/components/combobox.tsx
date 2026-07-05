"use client"

import * as React from "react"

import {Combobox as ComboboxPrimitive} from "@base-ui/react/combobox"
import {CaretDownIcon, CheckIcon, CaretUpIcon} from "@phosphor-icons/react"

import {cn} from "@agenta/primitive-ui/lib/utils"

const Combobox = ComboboxPrimitive.Root

function ComboboxTrigger({
    className,
    size = "default",
    children,
    ...props
}: ComboboxPrimitive.Trigger.Props & {
    size?: "sm" | "default"
}) {
    return (
        <ComboboxPrimitive.Trigger
            data-slot="combobox-trigger"
            data-size={size}
            className={cn(
                "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pe-2 ps-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=combobox-value]:line-clamp-1 *:data-[slot=combobox-value]:flex *:data-[slot=combobox-value]:items-center *:data-[slot=combobox-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            {children}
            <ComboboxPrimitive.Icon
                render={
                    <CaretDownIcon className="pointer-events-none size-4 text-muted-foreground" />
                }
            />
        </ComboboxPrimitive.Trigger>
    )
}

function ComboboxValue({placeholder, children, ...props}: ComboboxPrimitive.Value.Props) {
    return (
        <ComboboxPrimitive.Value placeholder={placeholder} {...props}>
            {children}
        </ComboboxPrimitive.Value>
    )
}

function ComboboxContent({
    className,
    children,
    side = "bottom",
    sideOffset = 4,
    align = "center",
    alignOffset = 0,
    ...props
}: ComboboxPrimitive.Popup.Props &
    Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
    return (
        <ComboboxPrimitive.Portal>
            <ComboboxPrimitive.Positioner
                side={side}
                sideOffset={sideOffset}
                align={align}
                alignOffset={alignOffset}
                className="isolate z-50"
            >
                <ComboboxPrimitive.Popup
                    data-slot="combobox-content"
                    className={cn(
                        "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                        className,
                    )}
                    {...props}
                >
                    {children}
                </ComboboxPrimitive.Popup>
            </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
    )
}

function ComboboxInput({className, ...props}: ComboboxPrimitive.Input.Props) {
    return (
        <ComboboxPrimitive.Input
            data-slot="combobox-input"
            className={cn(
                "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            {...props}
        />
    )
}

function ComboboxEmpty({className, ...props}: ComboboxPrimitive.Empty.Props) {
    return (
        <ComboboxPrimitive.Empty
            data-slot="combobox-empty"
            className={cn("py-3 text-center text-sm text-muted-foreground", className)}
            {...props}
        />
    )
}

function ComboboxItem({className, children, ...props}: ComboboxPrimitive.Item.Props) {
    return (
        <ComboboxPrimitive.Item
            data-slot="combobox-item"
            className={cn(
                "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pe-8 ps-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            {children}
            <ComboboxPrimitive.ItemIndicator
                render={
                    <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />
                }
            >
                <CheckIcon className="pointer-events-none" />
            </ComboboxPrimitive.ItemIndicator>
        </ComboboxPrimitive.Item>
    )
}

function ComboboxGroup({className, ...props}: ComboboxPrimitive.Group.Props) {
    return (
        <ComboboxPrimitive.Group
            data-slot="combobox-group"
            className={cn("scroll-my-1 p-1", className)}
            {...props}
        />
    )
}

function ComboboxLabel({className, ...props}: ComboboxPrimitive.GroupLabel.Props) {
    return (
        <ComboboxPrimitive.GroupLabel
            data-slot="combobox-label"
            className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
            {...props}
        />
    )
}

function ComboboxScrollUpButton({className, ...props}: React.ComponentPropsWithoutRef<"div">) {
    return (
        <div
            data-slot="combobox-scroll-up-button"
            className={cn(
                "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            <CaretUpIcon />
        </div>
    )
}

function ComboboxScrollDownButton({className, ...props}: React.ComponentPropsWithoutRef<"div">) {
    return (
        <div
            data-slot="combobox-scroll-down-button"
            className={cn(
                "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            <CaretDownIcon />
        </div>
    )
}

export {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxScrollDownButton,
    ComboboxScrollUpButton,
    ComboboxTrigger,
    ComboboxValue,
}
