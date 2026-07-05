"use client"

import {Tabs as TabsPrimitive} from "@base-ui/react/tabs"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "@agenta/primitive-ui/lib/utils"

function Tabs({className, orientation = "horizontal", ...props}: TabsPrimitive.Root.Props) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            data-orientation={orientation}
            className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
            {...props}
        />
    )
}

const tabsListVariants = cva(
    "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
    {
        variants: {
            variant: {
                default: "bg-muted",
                line: "gap-1 bg-transparent",
            },
            size: {
                default: "group-data-horizontal/tabs:h-8",
                sm: "group-data-horizontal/tabs:h-7 text-xs",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
)

function TabsList({
    className,
    variant = "default",
    size = "default",
    ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            data-variant={variant}
            data-size={size}
            className={cn(tabsListVariants({variant, size}), className)}
            {...props}
        />
    )
}

const tabsTriggerVariants = cva(
    [
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pe-1 has-data-[icon=inline-start]:ps-1 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-end-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
    ],
    {
        variants: {
            size: {
                default: "min-h-7 text-sm",
                sm: "min-h-6 text-xs",
            },
        },
        defaultVariants: {
            size: "default",
        },
    },
)

function TabsTrigger({
    className,
    size = "default",
    ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTriggerVariants>) {
    return (
        <TabsPrimitive.Tab
            data-slot="tabs-trigger"
            data-size={size}
            className={cn(tabsTriggerVariants({size}), className)}
            {...props}
        />
    )
}

function TabsContent({className, ...props}: TabsPrimitive.Panel.Props) {
    return (
        <TabsPrimitive.Panel
            data-slot="tabs-content"
            className={cn("flex-1 text-sm outline-none", className)}
            {...props}
        />
    )
}

export {Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, tabsTriggerVariants}
