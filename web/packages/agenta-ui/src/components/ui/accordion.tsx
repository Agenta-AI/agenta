import * as React from "react"

import * as AccordionPrimitive from "@radix-ui/react-accordion"
import {cva, type VariantProps} from "class-variance-authority"
import {ChevronRight} from "lucide-react"

import {cn} from "./utils"

/**
 * Accordion — Radix Accordion re-skinned to antd's `Collapse`, current source style (no
 * `forwardRef`, `data-slot` on every part). The antd name is "Collapse"; Radix's primitive
 * is "Accordion" — same widget, mapped in Collapse.md.
 *
 * antd → Radix mapping:
 *   <Collapse items={[{key,label,children}]} defaultActiveKey bordered ghost>
 *     → <Accordion type="single|multiple" collapsible defaultValue><AccordionItem value>
 *       <AccordionTrigger>label</AccordionTrigger><AccordionContent>children</AccordionContent>
 *       </AccordionItem></Accordion>
 *   antd `accordion` (one-open) → type="single"; default multi-open → type="multiple".
 *   bordered (default) → variant="bordered"; bordered={false} (ghost) → variant="ghost".
 *
 * Deferred (compose later, no antd-shaped props): collapsible="header"/"icon", `extra`,
 * custom `expandIcon`, `expandIconPosition="end"`.
 */

type AccordionVariant = "bordered" | "ghost"

const AccordionContext = React.createContext<AccordionVariant>("bordered")

const accordionRootVariants = cva("", {
    variants: {
        variant: {
            // overflow-hidden clips item corners to the group radius (antd borderRadiusLG=10px).
            bordered:
                "box-border border border-solid border-colorBorder rounded-control-lg overflow-hidden",
            ghost: "border-0 bg-transparent",
        },
    },
    defaultVariants: {variant: "bordered"},
})

const accordionTriggerVariants = cva(
    [
        // <button> under preflight-off: explicit bg (buttonface leaks) + font/box reset.
        // border-0: the header has NO border (dividers live on the items); without this the
        // app's global default border-width (~1.5px) leaks in currentColor on all 4 sides.
        // items-start matches antd's flex-start header: the label's 20px line box sits at the
        // top padding while the 22px caret box (below) centers the icon — antd's exact layout.
        // gap-3 = antd's `.ant-collapse-expand-icon { margin-inline-end: marginSM }` (12px, not 8).
        "box-border border-0 font-[inherit] flex w-full items-start gap-3 text-left",
        // antd header: paddingSM 12px vertical, padding 16px horizontal; colorTextHeading text.
        "px-4 py-3 text-field-md text-colorTextHeading cursor-pointer outline-none transition-colors",
        // antd Collapse's header uses the SHARED genFocusStyle(token) with no offset arg →
        // outline-offset 1px (outward), same as Radio/Checkbox/Tabs/Segmented. An inward
        // offset drew the ring inside the panel, which antd never does.
        "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        // Caret rotates 90° when open; data-state lives on the trigger, so target the marked svg.
        "[&[data-state=open]_[data-slot=accordion-caret]]:rotate-90",
    ],
    {
        variants: {
            // antd colorFillAlter == colorFillQuaternary in this theme → bg-fill-quaternary.
            variant: {bordered: "bg-fill-quaternary", ghost: "bg-transparent"},
        },
        defaultVariants: {variant: "bordered"},
    },
)

function Accordion({
    className,
    variant = "bordered",
    ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root> &
    VariantProps<typeof accordionRootVariants>) {
    return (
        <AccordionContext.Provider value={variant ?? "bordered"}>
            <AccordionPrimitive.Root
                data-slot="accordion"
                data-variant={variant}
                className={cn(accordionRootVariants({variant}), className)}
                {...props}
            />
        </AccordionContext.Provider>
    )
}

function AccordionItem({
    className,
    ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
    const variant = React.useContext(AccordionContext)
    return (
        <AccordionPrimitive.Item
            data-slot="accordion-item"
            className={cn(
                // border-0 first so the single bottom rule doesn't leak the app's default
                // border-width on the other 3 sides (preflight off). Ghost has no dividers.
                variant === "bordered" &&
                    "border-0 border-b border-solid border-colorBorder last:border-b-0",
                className,
            )}
            {...props}
        />
    )
}

function AccordionTrigger({
    className,
    children,
    ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
    const variant = React.useContext(AccordionContext)
    // Radix Header is an <h3>: preflight-off leaves its UA block margin (white bands +
    // extra height) and bold weight (leaks into the trigger via inherit) — reset both.
    return (
        <AccordionPrimitive.Header data-slot="accordion-header" className="flex m-0 font-normal">
            <AccordionPrimitive.Trigger
                data-slot="accordion-trigger"
                className={cn(accordionTriggerVariants({variant}), className)}
                {...props}
            >
                {/* antd expandIconPosition default = start; caret rotates 90° when open. antd
                    sizes its expand-icon box to fontHeight (22px = base 14px × lineHeight
                    1.5714) and centers the 12px icon in it; the flex-start header then makes
                    the header 46px tall and fixes the caret's vertical position. h-[22px] has
                    no scale key (h-5=20/h-6=24) — it IS antd's fontHeight, so kept as px. */}
                <span className="flex h-[22px] shrink-0 items-center">
                    <ChevronRight
                        data-slot="accordion-caret"
                        className="size-3 text-colorText transition-transform duration-200"
                    />
                </span>
                {children}
            </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
    )
}

function AccordionContent({
    className,
    children,
    ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
    const variant = React.useContext(AccordionContext)
    return (
        <AccordionPrimitive.Content
            data-slot="accordion-content"
            className={cn(
                // overflow-hidden is required for the height motion to clip.
                "overflow-hidden text-field-md text-foreground",
                // antd panel open/close height+opacity motion (Radix data-state + content-height var).
                "data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up",
                // antd content: 16px padding, top border colorBorder (border-0 first, preflight off).
                variant === "bordered" && "border-0 border-t border-solid border-colorBorder",
                className,
            )}
            {...props}
        >
            {/* antd content padding: bordered = `padding` 16px all round; ghost = `paddingSM padding`
                (12px vertical / 16px horizontal) — antd narrows the ghost body's vertical padding. */}
            <div className={variant === "bordered" ? "p-4" : "py-3 px-4"}>{children}</div>
        </AccordionPrimitive.Content>
    )
}

export {Accordion, AccordionItem, AccordionTrigger, AccordionContent, accordionRootVariants}
