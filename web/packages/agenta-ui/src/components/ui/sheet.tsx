import * as React from "react"

import * as SheetPrimitive from "@radix-ui/react-dialog"
import {cva, type VariantProps} from "class-variance-authority"
import {X} from "lucide-react"

import {cn} from "./utils"

/**
 * Sheet — a Radix Dialog primitive in @agenta/ui, re-skinned to antd's `Drawer` (a Drawer is
 * a Dialog whose content slides from a screen edge). Current source style (no `forwardRef`,
 * `data-slot` on every part). Overlay self-contained here — NOT imported from dialog.tsx.
 *
 * antd → @agenta/ui mapping:
 *   <Drawer open onClose title footer placement width/height getContainer>
 *     → <Sheet open onOpenChange><SheetTrigger/><SheetContent side>
 *         <SheetHeader><SheetTitle/><SheetDescription/></SheetHeader>
 *         …body… <SheetFooter/></SheetContent></Sheet>
 *   open→open · onClose→onOpenChange(false) · placement→side · title→SheetTitle ·
 *   footer→SheetFooter · getContainer→container (on SheetContent) · closable→showCloseButton.
 *
 * Chrome measured against antd Drawer (light + dark): panel bg colorBgContainer (NOT
 * colorBgElevated — identical white in light, but #141414 vs #242424 in dark; Modal uses
 * elevated, Drawer uses container), text colorText, borderless (shadow-only separation),
 * default width 378px (right/left) / height 378px (top/bottom), directional boxShadowDrawer*
 * (shadow-drawer-{side}). Mask = colorBgMask over the viewport. Header/footer 1px colorSplit
 * rule, 16px×24px / 8px×16px padding; body 24px.
 */

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                // antd mask = colorBgMask over the whole viewport; fades in/out.
                "fixed inset-0 z-40 bg-colorBgMask",
                "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
                className,
            )}
            {...props}
        />
    )
}

// The `side` variant drives three things together: (a) fixed positioning to that edge,
// (b) the matching directional drawer shadow, (c) the slide animation. antd's Drawer panel
// is BORDERLESS (measured borderWidth 0 on every edge) — the directional shadow alone casts
// the separation toward the viewport, so no border edge is drawn. `border-0` zeroes the
// app's global default border-width (preflight off) so no stray currentColor rule leaks.
// Default width/height 378px = antd Drawer's JS default (a literal, not a theme token —
// same as dialog.tsx's max-w-[520px]); callers override via `className` / `style`.
const sheetVariants = cva(
    ["fixed z-50 box-border flex flex-col border-0 bg-colorBgContainer text-colorText font-portal"],
    {
        variants: {
            side: {
                right: [
                    "inset-y-0 right-0 h-full w-[378px] max-w-full shadow-drawer-right",
                    "data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right",
                ],
                left: [
                    "inset-y-0 left-0 h-full w-[378px] max-w-full shadow-drawer-left",
                    "data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left",
                ],
                top: [
                    "inset-x-0 top-0 w-full h-[378px] max-h-full shadow-drawer-top",
                    "data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top",
                ],
                bottom: [
                    "inset-x-0 bottom-0 w-full h-[378px] max-h-full shadow-drawer-bottom",
                    "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
                ],
            },
        },
        defaultVariants: {side: "right"},
    },
)

function SheetContent({
    className,
    children,
    side = "right",
    container,
    overlayClassName,
    maskless,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> &
    VariantProps<typeof sheetVariants> & {
        /** Portal target. Defaults to document.body; pass an element to render inline (e.g. a
         * scroll container, or a forced-open parity story). antd `getContainer`. */
        container?: HTMLElement | null
        /** Overlay overrides. antd's `mask={{blur:true}}` maps to a backdrop filter here. */
        overlayClassName?: string
        /**
         * Drop the overlay entirely, for antd's `mask={false}`. A transparent overlay is NOT
         * equivalent: it still spans the viewport and swallows every click behind the drawer.
         * Pair with `modal={false}` on `Sheet` so Radix also stops putting
         * `pointer-events: none` on `<body>`.
         */
        maskless?: boolean
    }) {
    return (
        <SheetPortal container={container}>
            {maskless ? null : <SheetOverlay className={overlayClassName} />}
            <SheetPrimitive.Content
                data-slot="sheet-content"
                data-side={side}
                className={cn(sheetVariants({side}), className)}
                {...props}
            >
                {children}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
}

function SheetHeader({
    className,
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<"div"> & {
    /** antd `closable`. Renders the close X at the START of the header row (before the title),
     * matching antd Drawer's `.ant-drawer-close`. */
    showCloseButton?: boolean
}) {
    return (
        <div
            data-slot="sheet-header"
            className={cn(
                // antd `.ant-drawer-header` > `.ant-drawer-header-title`: a flex row, 16px×24px
                // padding, 1px colorSplit bottom rule, with the close BEFORE the title.
                // border-0 first (preflight off) so the single bottom rule doesn't leak 3 sides.
                // box-border to match antd's border-box (preflight off convention).
                "box-border flex items-center gap-2 px-6 py-4 border-0 border-b border-solid border-colorSplit",
                className,
            )}
            {...props}
        >
            {showCloseButton && (
                <SheetPrimitive.Close
                    data-slot="sheet-close"
                    className={cn(
                        // antd `.ant-drawer-close`: 22px box, 14px icon, colorIcon, sits FIRST in
                        // the header row (its marginInlineEnd 8px = the header's gap-2). Native
                        // <button> resets under preflight-off: bg/font/padding/border.
                        "box-border shrink-0 p-0 bg-transparent border-0 font-[inherit]",
                        "flex size-[22px] items-center justify-center rounded-control-sm",
                        "text-colorIcon cursor-pointer outline-none transition-colors",
                        "hover:bg-fill-quaternary hover:text-colorIconHover",
                        "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring",
                    )}
                    aria-label="Close"
                >
                    <X className="size-3.5" />
                </SheetPrimitive.Close>
            )}
            {children}
        </div>
    )
}

function SheetFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            className={cn(
                // antd `.ant-drawer-footer`: buttons right-aligned, 1px colorSplit top rule,
                // padding 8px×16px. border-0 first (single-side border, preflight off).
                // box-border to match antd's border-box (preflight off convention).
                "mt-auto box-border flex flex-row items-center justify-end gap-2 px-4 py-2 border-0 border-t border-solid border-colorSplit",
                className,
            )}
            {...props}
        />
    )
}

function SheetTitle({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Title>) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            // antd `.ant-drawer-title`: 14px, line-height 22px, weight 600, colorTextHeading.
            // (Drawer title is NOT fontSizeLG — measured 14px, unlike Modal's 16px title.)
            // m-0: Radix Title is an <h2>; preflight-off leaves its UA margin-block (~0.83em),
            // which inflates the flex header row by ~23px and cascades the body down. Reset it.
            className={cn("m-0 text-field-lg font-semibold text-colorTextHeading", className)}
            {...props}
        />
    )
}

function SheetDescription({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            // m-0: Radix Description is a <p>; preflight-off leaves its UA margin-block.
            className={cn("m-0 text-field-md text-colorText", className)}
            {...props}
        />
    )
}

export {
    Sheet,
    SheetTrigger,
    SheetPortal,
    SheetOverlay,
    SheetContent,
    SheetClose,
    SheetTitle,
    SheetDescription,
    SheetHeader,
    SheetFooter,
    sheetVariants,
}
