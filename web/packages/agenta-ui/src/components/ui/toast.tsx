import * as React from "react"

import {CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert, X} from "lucide-react"
import {Toaster as Sonner, type ToasterProps} from "sonner"

import {buttonVariants} from "./button"
import {cn} from "./utils"

/**
 * Toaster — Sonner drawn as shadcn's toast (top-centre stack, expand on hover, swipe to
 * dismiss); `message.*` drives it. Sonner's own skin is off; the classes below are the look.
 */

// Sonner's stylesheet is injected at runtime, so ties on specificity go to it: the state
// selectors below carry `[data-sonner-toast]` to win.
const toastClassNames: NonNullable<NonNullable<ToasterProps["toastOptions"]>["classNames"]> = {
    toast: cn(
        "group/toast box-border flex w-full items-center gap-3 rounded-2xl border border-solid border-border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-lg outline-none select-none",
        "[&[data-sonner-toast]:focus-visible]:border-ring [&[data-sonner-toast]:focus-visible]:shadow-[0_0_0_3px_var(--ag-controlOutline)]",
        // Enter from the stack's edge on shadcn's ease-out; leave quickly (Sonner unmounts 200ms in).
        "[&[data-y-position=bottom]:not([data-mounted=true])]:[--y:translateY(150%)]",
        "[&[data-y-position=top]:not([data-mounted=true])]:[--y:translateY(-150%)]",
        "[&[data-sonner-toast]:not([data-swiping=true])]:[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "[&[data-sonner-toast][data-removed=true][data-swiping=false]]:[transition:transform_200ms_ease-in,opacity_200ms]",
        // Toasts behind the front one show only their edge.
        "[&[data-sonner-toast]>*]:[transition:opacity_250ms_cubic-bezier(0.22,1,0.36,1)]",
        "[&[data-expanded=false][data-front=false]>*]:opacity-0",
    ),
    // `relative size-4`: Sonner centers the loading icon absolutely inside this box.
    icon: "relative flex size-4 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:size-4",
    // Sonner's loader wrapper is inline; `flex` drops the line-box slack that pushes the spinner up.
    loader: "flex items-center justify-center",
    // `min-h-7` keeps a close-less (loading) toast as tall as the others.
    content: "flex min-h-7 min-w-0 flex-1 flex-col justify-center gap-1",
    title: "text-sm font-normal",
    description: "text-sm text-muted-foreground",
    actionButton: cn(buttonVariants({variant: "outline", size: "sm"}), "shrink-0"),
    cancelButton: cn(buttonVariants({variant: "outline", size: "sm"}), "shrink-0"),
    // Sonner renders the close button first; `order-last` seats it after the actions.
    closeButton: cn(
        buttonVariants({variant: "ghost", size: "icon-sm"}),
        "relative order-last shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
    ),
}

// Top-centre by default: drawers and their action buttons live at the bottom right. Every
// placement value is a prop, so a host can move or resize the stack.
function Toaster({
    position = "top-center",
    offset = 16,
    mobileOffset = 16,
    gap = 8,
    visibleToasts = 3,
    closeButton = true,
    style,
    toastOptions,
    ...props
}: ToasterProps) {
    return (
        <Sonner
            // Colors come from the tokens, so Sonner's dark skin (and its description color) stays off.
            theme="light"
            position={position}
            offset={offset}
            mobileOffset={mobileOffset}
            gap={gap}
            visibleToasts={visibleToasts}
            closeButton={closeButton}
            className="toaster group"
            icons={{
                success: <CircleCheck />,
                info: <Info />,
                warning: <TriangleAlert />,
                error: <OctagonX className="text-error" />,
                loading: <LoaderCircle className="animate-spin" />,
                close: <X />,
            }}
            toastOptions={{
                unstyled: true,
                ...toastOptions,
                classNames: {...toastClassNames, ...toastOptions?.classNames},
                // Sonner's stack rule reads this token raw: it becomes `1 - index * 0.1`, shadcn's scale.
                style: {
                    "--scale": "var(--toasts-before) * 0.1 + 1",
                    ...toastOptions?.style,
                } as React.CSSProperties,
            }}
            style={
                {
                    // shadcn's `max-w-sm` viewport; the font is stated because the stack mounts
                    // outside the app's font wrapper.
                    "--width": "24rem",
                    fontFamily:
                        "var(--font-inter, var(--font-sans, var(--ant-font-family, system-ui, sans-serif)))",
                    ...style,
                } as React.CSSProperties
            }
            {...props}
        />
    )
}

export {Toaster}
