import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * IconTile — the rounded square that leads a server row, a sheet header or an empty state.
 *
 * `info` is the identity tile (a tinted fill with the glyph in the info foreground); `muted` is
 * the empty-state tile. The spec draws the fill with `--info`, the system's info FOREGROUND, and
 * a white glyph on top; this uses `--info-bg` with an `--info` glyph, which is the same reading
 * in both themes and keeps the system's own foreground/fill convention.
 *
 * Radius is off the control scale on purpose: the spec's 5 / 6 / 10 px do not exist as tokens and
 * `rounded-md` is 6 px on /w and 8 px on /m, so a token here would render two different tiles.
 * The glyph takes `currentColor` and its size from the tile, so a caller passes a bare icon.
 */
const iconTileVariants = cva(
    "box-border inline-flex shrink-0 items-center justify-center [&_svg]:shrink-0",
    {
        variants: {
            size: {
                24: "size-6 rounded-[5px] [&_svg]:size-[14px]",
                28: "size-7 rounded-[6px] [&_svg]:size-4",
                32: "size-8 rounded-[6px] [&_svg]:size-4",
                44: "size-11 rounded-[10px] [&_svg]:size-[22px]",
            },
            tone: {
                info: "bg-colorInfoBg text-colorInfo",
                muted: "bg-colorFillTertiary text-colorTextTertiary",
            },
        },
        defaultVariants: {size: 28, tone: "info"},
    },
)

export type IconTileSize = 24 | 28 | 32 | 44
export type IconTileTone = "info" | "muted"

export interface IconTileProps
    extends
        Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
        VariantProps<typeof iconTileVariants> {
    size?: IconTileSize
    tone?: IconTileTone
    children?: React.ReactNode
}

export function IconTile({className, size = 28, tone = "info", children, ...props}: IconTileProps) {
    return (
        <span
            data-slot="icon-tile"
            data-size={size}
            data-tone={tone}
            className={cn(iconTileVariants({size, tone}), className)}
            {...props}
        >
            {children}
        </span>
    )
}

export {iconTileVariants}
