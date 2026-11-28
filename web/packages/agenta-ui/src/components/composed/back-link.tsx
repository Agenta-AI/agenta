import * as React from "react"

import {ArrowLeftIcon} from "@phosphor-icons/react"
import {Slot, Slottable} from "@radix-ui/react-slot"

import {cn} from "../ui/utils"

/**
 * An item page's way up on an expanded window: "← Automations" over the title. The label names
 * the parent page, never "Back". 24px tall, its text and arrow on the title's edge (the -6px
 * margin takes back the padding), muted until hovered.
 *
 * `asChild` puts it on the app's router link: `<BackLink asChild><Link href={...}>Automations</Link></BackLink>`.
 * Without it, it is a button for an in-page return (`onClick`).
 */
export const BackLink = ({
    asChild = false,
    size = "default",
    className,
    children,
    ...props
}: React.ComponentProps<"button"> & {
    asChild?: boolean
    /** `bar`: the compact bar's Back, 28px and in the text colour, with a 16px arrow. */
    size?: "default" | "bar"
}) => {
    const Comp = asChild ? Slot : "button"
    return (
        <Comp
            data-slot="back-link"
            {...(asChild ? {} : {type: "button" as const})}
            className={cn(
                "-ml-1.5 inline-flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1.5 text-label no-underline transition-colors hover:bg-accent hover:text-foreground focus-ring",
                size === "bar"
                    ? "h-control-sm rounded-md text-foreground"
                    : "h-control-xs rounded-sm text-muted-foreground",
                className,
            )}
            {...props}
        >
            <ArrowLeftIcon
                aria-hidden
                className={cn("shrink-0", size === "bar" ? "size-4" : "size-3.5")}
            />
            <Slottable>{children}</Slottable>
        </Comp>
    )
}
