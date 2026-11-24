import * as React from "react"

import {ArrowLeftIcon} from "@phosphor-icons/react"
import {Slot, Slottable} from "@radix-ui/react-slot"

import {cn} from "./utils"

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
    className,
    children,
    ...props
}: React.ComponentProps<"button"> & {asChild?: boolean}) => {
    const Comp = asChild ? Slot : "button"
    return (
        <Comp
            data-slot="back-link"
            {...(asChild ? {} : {type: "button" as const})}
            className={cn(
                "-ml-1.5 inline-flex h-control-xs min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1.5 text-label text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground focus-ring",
                className,
            )}
            {...props}
        >
            <ArrowLeftIcon aria-hidden className="size-3.5 shrink-0" />
            <Slottable>{children}</Slottable>
        </Comp>
    )
}
