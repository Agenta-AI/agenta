import * as React from "react"

import * as TabsPrimitive from "@radix-ui/react-tabs"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Tabs — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skinned to antd's default LINE tabs via the shared token bridge.
 *
 * SCOPE: the antd LINE type (default) plus shadcn's own `pill` look — `TabsList variant="pill"`
 * is the compact segmented switch (a muted track, the active trigger raised on the surface),
 * with no ink bar. antd `type="card"`/`"editable-card"`, `tabPosition` (left/right/bottom), and
 * `addIcon`/editable affordances are a deferred variant — compose later, do NOT add antd-shaped
 * props speculatively.
 *
 * Ink bar: Radix has none, so `TabsList` renders a single absolutely-positioned bar and
 * measures the active trigger (offsetLeft/offsetWidth) to position it, transitioning left+width
 * on selection change — antd's SLIDING animated ink bar. Re-measured on value change (data-state
 * MutationObserver), resize (ResizeObserver), and font load.
 *
 * antd → @agenta/ui mapping:
 *   <Tabs items={[{key,label,children,disabled}]} activeKey onChange />
 *     → <Tabs value onValueChange><TabsList><TabsTrigger value>label</TabsTrigger></TabsList>
 *       <TabsContent value>children</TabsContent></Tabs>
 */

const tabsTriggerVariants = cva([
    // CONTROL_RESET — preflight is off app-wide; triggers are <button>s (see button.tsx).
    // bg-transparent is REQUIRED: without it the UA button-face (rgb(239,239,239)) leaks —
    // subtle in light, loud in dark. antd's LINE tab is fully transparent (no bg, no pill).
    "box-border border-solid font-[inherit] px-0 bg-transparent",
    // antd horizontalItemPadding = paddingSM 12px vertical, 0 horizontal; titleFontSize = 12px.
    "inline-flex items-center gap-2 py-3 text-field-md cursor-pointer whitespace-nowrap outline-none transition-colors",
    // No bottom border: antd's nav is 12+lineHeight+12 = 44px and paints BOTH the rule and the
    // ink bar with absolutely-positioned boxes, so neither adds height. -mb-px lets the list's
    // 1px rule overlap the trigger's last row exactly like antd's `nav::before {bottom:0}`.
    "border-0 -mb-px",
    // itemColor/itemHoverColor are LIGHT-ONLY app overrides (antd-themeConfig.json) — the palette
    // pair carries antd's dark defaults. itemSelectedColor (active) = colorPrimary.
    "text-[var(--ag-tab-item)] data-[state=active]:text-primary",
    // itemHoverColor, itemActiveColor (pressed) = colorPrimaryActive — inactive only.
    "data-[state=inactive]:hover:text-[var(--ag-tab-item-hover)] data-[state=inactive]:active:text-btn-primary-active",
    // itemDisabled = colorTextDisabled, not-allowed.
    "disabled:cursor-not-allowed disabled:text-disabled disabled:pointer-events-none",
    // antd LINE tab focus = genFocusOutline(token) → 4px colorPrimaryBorder, offset +1.
    // (The -3px inset variant is antd's `type="card"` rule only.)
    "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
])

export type TabsListVariant = "line" | "pill"

// The list tells its triggers which look they wear, so a call-site sets the variant once.
const TabsVariantContext = React.createContext<TabsListVariant>("line")

// shadcn's default trigger: a small rounded segment, raised (surface + shadow) while active.
const pillTriggerClass = [
    "box-border border-0 border-solid font-[inherit] bg-transparent",
    "inline-flex h-full items-center justify-center gap-1.5 rounded-sm px-2 py-0.5 text-field-md",
    "cursor-pointer whitespace-nowrap outline-none transition-[color,box-shadow,background-color]",
    "text-muted-foreground hover:text-foreground",
    "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
].join(" ")

function Tabs({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            className={cn("flex flex-col", className)}
            {...props}
        />
    )
}

// useLayoutEffect on the client (measure before paint, no flash), useEffect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

function TabsList({
    className,
    children,
    variant = "line",
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {variant?: TabsListVariant}) {
    const listRef = React.useRef<HTMLDivElement>(null)
    const [ink, setInk] = React.useState<{left: number; width: number} | null>(null)

    useIsoLayoutEffect(() => {
        const list = listRef.current
        // The pill look has no ink bar to place.
        if (!list || variant === "pill") return
        const measure = () => {
            const active = list.querySelector<HTMLElement>(
                '[data-slot=tabs-trigger][data-state="active"]',
            )
            setInk(active ? {left: active.offsetLeft, width: active.offsetWidth} : null)
        }
        measure()
        // value change flips data-state; resize/font-load shift trigger geometry.
        const mo = new MutationObserver(measure)
        mo.observe(list, {attributes: true, attributeFilter: ["data-state"], subtree: true})
        const ro = new ResizeObserver(measure)
        ro.observe(list)
        document.fonts?.ready.then(measure).catch(() => {})
        return () => {
            mo.disconnect()
            ro.disconnect()
        }
    }, [variant])

    if (variant === "pill")
        return (
            <TabsVariantContext.Provider value="pill">
                <TabsPrimitive.List
                    ref={listRef}
                    data-slot="tabs-list"
                    data-variant="pill"
                    className={cn(
                        "box-border inline-flex h-7 items-center gap-0.5 rounded-md border-0 bg-muted p-0.5 text-muted-foreground",
                        className,
                    )}
                    {...props}
                >
                    {children}
                </TabsPrimitive.List>
            </TabsVariantContext.Provider>
        )

    return (
        <TabsPrimitive.List
            ref={listRef}
            data-slot="tabs-list"
            className={cn(
                // MEASURED gutter = 24px between tabs (antd v6 in this theme: non-first tab
                // margin-left 24px, first tab 0 — start-edge distance = tab width + 24). nav
                // margin-bottom = margin 16px. border-0 first so the single bottom rule doesn't
                // leak the app's default border-width on the other 3 sides (preflight off).
                // relative: positions the sliding ink bar.
                "relative box-border inline-flex items-center gap-6 mb-4 border-0 border-b border-solid border-colorBorderSecondary",
                className,
            )}
            {...props}
        >
            {children}
            {ink ? (
                <span
                    data-slot="tabs-ink-bar"
                    aria-hidden
                    // antd inkBar: 2px colorPrimary, overlapping the 1px bottom rule; slides
                    // left+width over motionDurationSlow (0.3s) with antd's ease-in-out bezier.
                    className="absolute -bottom-px h-0.5 bg-primary transition-[left,width] duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)]"
                    style={{left: ink.left, width: ink.width}}
                />
            ) : null}
        </TabsPrimitive.List>
    )
}

export interface TabsTriggerProps
    extends
        React.ComponentProps<typeof TabsPrimitive.Trigger>,
        VariantProps<typeof tabsTriggerVariants> {}

function TabsTrigger({className, ...props}: TabsTriggerProps) {
    const variant = React.useContext(TabsVariantContext)
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(variant === "pill" ? pillTriggerClass : tabsTriggerVariants(), className)}
            {...props}
        />
    )
}

function TabsContent({className, ...props}: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("outline-none", className)}
            {...props}
        />
    )
}

export {Tabs, TabsList, TabsTrigger, TabsContent, tabsTriggerVariants}
