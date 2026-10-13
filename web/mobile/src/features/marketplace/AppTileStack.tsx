import {useState} from "react"

import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {AppTile, type AppTileSize} from "./AppTile"
import type {TemplateApp} from "./marketplaceView"

// Earlier tiles sit on top.
const LAYER = ["z-[6]", "z-[5]", "z-[4]", "z-[3]", "z-[2]", "z-[1]"]

const OVERLAP: Record<AppTileSize, string> = {
    "2xs": "-ml-1",
    xs: "-ml-1",
    sm: "-ml-1.5",
    md: "-ml-2",
    lg: "-ml-3",
    xl: "-ml-4",
}

// The cap depends on the tile size alone, so a surface never shows a different set.
const MAX: Record<AppTileSize, number> = {"2xs": 4, xs: 4, sm: 4, md: 3, lg: 5, xl: 6}

// The first tile holds the stack's edge; each later one turns and slides a little further.
const tilePose = (index: number, fanned: boolean, lifted: boolean) =>
    fanned ? {rotate: index * 3, x: index, y: lifted ? -4 : 0} : {rotate: 0, x: 0, y: 0}

/** A template's apps as overlapping tiles that fan out under the pointer; the rest become "+N". */
export const AppTileStack = ({
    apps,
    size = "md",
    decorative = false,
    className,
}: {
    apps: TemplateApp[]
    size?: AppTileSize
    /** The app names are written beside the stack. */
    decorative?: boolean
    className?: string
}) => {
    const presets = useMotionPresets()
    const fans = !presets.reduced
    const [fanned, setFanned] = useState(false)
    const [lifted, setLifted] = useState<number | null>(null)
    const shown = apps.slice(0, MAX[size])
    const more = apps.length - shown.length
    return (
        <motion.div
            role={decorative ? undefined : "list"}
            aria-label={decorative ? undefined : "Apps"}
            aria-hidden={decorative || undefined}
            onHoverStart={() => fans && setFanned(true)}
            onHoverEnd={() => setFanned(false)}
            className={cn("flex w-fit items-center", className)}
        >
            {shown.map((app, index) => (
                <motion.span
                    key={app.slug}
                    role={decorative ? undefined : "listitem"}
                    initial={false}
                    animate={tilePose(index, fanned, lifted === index)}
                    onHoverStart={() => fans && setLifted(index)}
                    onHoverEnd={() => setLifted((value) => (value === index ? null : value))}
                    transition={presets.fanTransition}
                    className={cn(
                        "relative flex origin-bottom hover:z-10",
                        LAYER[index],
                        index > 0 && OVERLAP[size],
                    )}
                >
                    <AppTile
                        app={app}
                        size={size}
                        decorative={decorative}
                        className="ring-2 ring-background"
                    />
                </motion.span>
            ))}
            {more > 0 ? (
                <span
                    role={decorative ? undefined : "listitem"}
                    className="text-muted-foreground ml-1.5 text-xs"
                >
                    +{more}
                </span>
            ) : null}
        </motion.div>
    )
}
