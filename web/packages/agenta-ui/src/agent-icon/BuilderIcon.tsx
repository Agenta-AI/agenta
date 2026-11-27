import {type IconProps, SparkleIcon} from "@phosphor-icons/react"

/**
 * The Builder's mark: one four-point sparkle, the glyph the design draws wherever the Builder
 * appears (main sidebar, session header, panel title, builder page). Inside a Button the button's
 * glyph size applies; elsewhere `size` sets it.
 */
export function BuilderIcon({size = 16, ...props}: Omit<IconProps, "ref">) {
    return <SparkleIcon size={size} aria-hidden {...props} />
}
