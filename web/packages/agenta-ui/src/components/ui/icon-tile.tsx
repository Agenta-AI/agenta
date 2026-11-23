import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * IconTile is the Mark: the square that leads a row, a header or an empty state (DESIGN.md CONS-01).
 * Five sizes by place: 16 inline, nav and menus; 20 pickers and chips; 24 list rows; 32 page and
 * dialog headers; 40 empty states. Neutral by default; `muted` has no fill; `brand` is only for
 * the brand mark on Home. Radius steps with size (4 / 6 / 8). The glyph takes `currentColor` and
 * its size from the tile, so a caller passes a bare icon.
 */
const iconTileVariants = cva(
    "box-border inline-flex shrink-0 items-center justify-center font-medium leading-none [&_svg]:shrink-0",
    {
        variants: {
            size: {
                16: "size-4 rounded-sm text-caption [&_svg]:size-2.5",
                20: "size-5 rounded-sm text-caption [&_svg]:size-3",
                24: "size-6 rounded-md text-caption [&_svg]:size-3.5",
                32: "size-8 rounded-md text-label [&_svg]:size-4",
                40: "size-10 rounded-lg text-[15px] [&_svg]:size-5",
            },
            tone: {
                neutral: "bg-secondary text-muted-foreground",
                muted: "bg-transparent text-muted-foreground",
                brand: "bg-brand/15 text-foreground",
            },
        },
        defaultVariants: {size: 24, tone: "neutral"},
    },
)

export type IconTileSize = 16 | 20 | 24 | 32 | 40
export type IconTileTone = "neutral" | "muted" | "brand"

export interface IconTileProps
    extends
        Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
        VariantProps<typeof iconTileVariants> {
    size?: IconTileSize
    tone?: IconTileTone
    children?: React.ReactNode
}

export function IconTile({className, size = 24, tone = "neutral", children, ...props}: IconTileProps) {
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
