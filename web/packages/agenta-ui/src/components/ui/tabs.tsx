import * as React from "react"

import * as TabsPrimitive from "@radix-ui/react-tabs"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Tabs — the shadcn tabs on Radix. `TabsList variant="line"` (default here, antd's look-alike)
 * underlines the active trigger; `variant="pill"` is shadcn's default muted track with a raised
 * active segment. antd mapping: items→TabsTrigger/TabsContent, activeKey→value, onChange→onValueChange.
 */

export type TabsListVariant = "line" | "pill"

// The list tells its triggers which look they wear, so a call-site sets the variant once.
const TabsVariantContext = React.createContext<TabsListVariant>("line")

const tabsListVariants = cva(
    // box-border/border-0: preflight is off app-wide.
    "group/tabs-list box-border inline-flex h-8 w-fit items-center justify-center border-0 p-[3px] text-muted-foreground",
    {
        variants: {
            variant: {
                pill: "rounded-control-lg bg-muted",
                line: "gap-1 rounded-none bg-transparent",
            },
        },
        defaultVariants: {variant: "line"},
    },
)

const tabsTriggerVariants = cva(
    [
        // CONTROL_RESET — preflight is off; triggers are <button>s, so the UA face is reset.
        "box-border border border-solid border-transparent font-[inherit] bg-transparent",
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap",
        "rounded-control-sm px-1.5 py-0.5 text-sm font-medium text-muted-foreground",
        "cursor-pointer outline-none transition-[color,background-color,box-shadow]",
        "hover:text-foreground data-[state=active]:text-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    ],
    {
        variants: {
            variant: {
                // Raised on the surface while active (a hairline + tint in dark).
                pill: "data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-[color:color-mix(in_srgb,var(--ag-colorBorder)_30%,transparent)]",
                // A 2px underline 5px below the trigger, shown while active.
                line: "after:absolute after:inset-x-0 after:-bottom-[5px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100",
            },
        },
        defaultVariants: {variant: "line"},
    },
)

function Tabs({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    )
}

function TabsList({
    className,
    variant = "line",
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
    const resolved = variant ?? "line"
    return (
        <TabsVariantContext.Provider value={resolved}>
            <TabsPrimitive.List
                data-slot="tabs-list"
                data-variant={resolved}
                className={cn(tabsListVariants({variant: resolved}), className)}
                {...props}
            />
        </TabsVariantContext.Provider>
    )
}

export interface TabsTriggerProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {}

function TabsTrigger({className, ...props}: TabsTriggerProps) {
    const variant = React.useContext(TabsVariantContext)
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(tabsTriggerVariants({variant}), className)}
            {...props}
        />
    )
}

function TabsContent({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("flex-1 outline-none", className)}
            {...props}
        />
    )
}

export {Tabs, TabsList, TabsTrigger, TabsContent, tabsTriggerVariants, tabsListVariants}
