import * as React from "react"

import * as LabelPrimitive from "@radix-ui/react-label"

import {cn} from "./utils"

/**
 * Label — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot`). Renders a native `<label>`; associate it with a control via
 * `htmlFor`. Disabled styling follows two shadcn idioms: `peer-disabled:*` (control is a
 * sibling marked `peer`) and `group-data-[disabled=true]:*` (an ancestor sets `data-disabled`).
 *
 * `font-[inherit]` keeps the app's Inter (preflight is off, so a bare element can fall back to
 * the UA font). Colour/size are intentionally NOT baked in here — the composing surface (e.g.
 * `Field`) sets them, so `Label` stays a neutral primitive.
 */
function Label({className, ...props}: React.ComponentProps<typeof LabelPrimitive.Root>) {
    return (
        <LabelPrimitive.Root
            data-slot="label"
            className={cn(
                "inline-flex select-none items-center gap-1 font-[inherit] text-foreground",
                "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
                className,
            )}
            {...props}
        />
    )
}

export {Label}
