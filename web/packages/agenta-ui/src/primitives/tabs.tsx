import * as React from "react"

import * as TabsPrimitive from "@radix-ui/react-tabs"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "../foundation/utils/cn"

/**
 * Tabs — the shadcn tabs on Radix. `TabsList variant="line"` (default here, antd's look-alike)
 * underlines the active trigger; `variant="track"` is shadcn's default muted track with a raised
 * active segment. antd mapping: items→TabsTrigger/TabsContent, activeKey→value, onChange→onValueChange.
 */

type TabsListVariant = "line" | "track"

// The list tells its triggers which look they wear, so a call-site sets the variant once.
const TabsVariantContext = React.createContext<TabsListVariant>("line")

const tabsListVariants = cva(
    // box-border/border-0: preflight is off app-wide.
    "group/tabs-list box-border inline-flex h-8 w-fit items-center justify-center border-0 p-1 text-muted-foreground",
    {
        variants: {
            variant: {
                track: "rounded-control-lg bg-muted",
                line: "relative gap-1 rounded-none bg-transparent",
            },
        },
        defaultVariants: {variant: "line"},
    },
)

const tabsTriggerVariants = cva(
    [
        // CONTROL_RESET — preflight is off; triggers are <button>s, so the UA face is reset.
        "box-border border border-solid border-transparent font-[inherit] bg-transparent",
        "relative inline-flex h-control-xs flex-1 items-center justify-center gap-1.5 whitespace-nowrap",
        "rounded-control-sm px-1.5 py-0.5 text-label text-muted-foreground",
        "cursor-pointer outline-none transition-[color,background-color,box-shadow]",
        "hover:text-foreground data-[state=active]:text-foreground",
        "focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    ],
    {
        variants: {
            variant: {
                // Raised on the surface while active, like the Segmented thumb.
                track: "data-[state=active]:bg-background data-[state=active]:shadow-raised",
                // The underline is the list's one sliding indicator (TabsIndicator).
                line: "",
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

/**
 * The line variant's underline: one 2px bar at the list's bottom edge that slides to the active
 * tab (MOTION-01), as the Segmented thumb does. It sits on whatever line the list's bottom meets.
 */
function TabsIndicator() {
    const ref = React.useRef<HTMLSpanElement>(null)
    const [box, setBox] = React.useState<{left: number; width: number} | null>(null)
    const [ready, setReady] = React.useState(false)
    React.useLayoutEffect(() => {
        // Its own element finds the list: a child's layout effect runs before the list's ref is set.
        const list = ref.current?.parentElement
        if (!list) return undefined
        const measure = () => {
            // A hidden list measures 0: keep the last place, so showing it does not slide.
            if (!list.getClientRects().length) return
            const active = list.querySelector<HTMLElement>(
                '[data-slot="tabs-trigger"][data-state="active"]',
            )
            setBox(active ? {left: active.offsetLeft, width: active.offsetWidth} : null)
        }
        measure()
        const mutations = new MutationObserver(measure)
        mutations.observe(list, {subtree: true, attributes: true, attributeFilter: ["data-state"]})
        const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
        sizes?.observe(list)
        return () => {
            mutations.disconnect()
            sizes?.disconnect()
        }
    }, [])
    // The first place is set without motion; only moves between tabs slide.
    React.useEffect(() => {
        if (box && !ready) requestAnimationFrame(() => setReady(true))
    }, [box, ready])
    return (
        <span
            ref={ref}
            aria-hidden
            data-slot="tabs-indicator"
            className={cn(
                "pointer-events-none absolute bottom-0 left-0 h-0.5 bg-foreground",
                ready &&
                    "motion-safe:transition-[transform,width] motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-in-out)]",
            )}
            style={
                box ? {transform: `translateX(${box.left}px)`, width: box.width} : {display: "none"}
            }
        />
    )
}

function TabsList({
    className,
    variant = "line",
    children,
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
            >
                {children}
                {resolved === "line" ? <TabsIndicator /> : null}
            </TabsPrimitive.List>
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
