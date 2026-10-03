import {cn} from "@/lib/utils"

import type {TemplateApp} from "./marketplaceView"

export type AppTileSize = "2xs" | "xs" | "sm" | "md" | "lg" | "xl"

// Brand logos are drawn for a light ground, so a logo tile stays white in both themes.
const TILE: Record<AppTileSize, string> = {
    "2xs": "size-4 rounded-[4px] [&>img]:size-2.5",
    xs: "size-5 rounded-[5px] [&>img]:size-3",
    sm: "size-6 rounded-[5px] [&>img]:size-3.5",
    md: "size-8 rounded-md [&>img]:size-4",
    lg: "size-11 rounded-lg [&>img]:size-5",
    xl: "size-14 rounded-xl [&>img]:size-7",
}

/** One app's brand mark on a small tile; an app without a logo shows its initial. */
export const AppTile = ({
    app,
    size = "md",
    decorative = false,
    className,
}: {
    app: TemplateApp
    size?: AppTileSize
    /** The app's name is already written beside the tile. */
    decorative?: boolean
    className?: string
}) => (
    <span
        title={decorative ? undefined : app.name}
        className={cn(
            "box-border inline-flex shrink-0 items-center justify-center border border-solid border-border",
            app.logo ? "bg-colorWhite" : "bg-muted",
            TILE[size],
            className,
        )}
    >
        {app.logo ? (
            <img src={app.logo} alt={decorative ? "" : app.name} className="object-contain" />
        ) : (
            <span
                role={decorative ? undefined : "img"}
                aria-hidden={decorative || undefined}
                aria-label={decorative ? undefined : app.name}
                className="text-xs font-medium text-foreground"
            >
                {app.name.slice(0, 1).toUpperCase()}
            </span>
        )}
    </span>
)
