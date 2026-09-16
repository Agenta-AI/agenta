import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * IconTile — the square glyph tile the MCP surfaces put in front of a server, a connection
 * row, or an empty state.
 *
 * One generic tile for every server: there is no per-server branding here, because the
 * catalogue is whatever address someone typed and a tile that looked branded for two known
 * providers would read as broken for the rest.
 *
 * The `info` tone fills with the info BACKGROUND token and draws the glyph in the info
 * foreground, which is the system's own convention for the pair. The glyph inherits
 * `currentColor`, so an icon set to any fixed colour will not follow the theme.
 */
const iconTileVariants = cva(
    "box-border inline-flex shrink-0 items-center justify-center [&_svg]:size-[55%]",
    {
        variants: {
            tone: {
                info: "bg-colorInfoBg text-colorInfo",
                muted: "bg-colorFillTertiary text-colorTextTertiary",
            },
            size: {
                24: "size-6 rounded-[5px]",
                28: "size-7 rounded-md",
                32: "size-8 rounded-md",
                44: "size-11 rounded-[10px]",
            },
        },
        defaultVariants: {tone: "info", size: 32},
    },
)

export interface IconTileProps
    extends
        Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
        VariantProps<typeof iconTileVariants> {}

export function IconTile({className, tone, size, children, ...props}: IconTileProps) {
    return (
        <span
            data-slot="icon-tile"
            aria-hidden="true"
            className={cn(iconTileVariants({tone, size}), className)}
            {...props}
        >
            {children}
        </span>
    )
}

export {iconTileVariants}
