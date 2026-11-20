import {Sparkle, type LucideProps} from "lucide-react"

/**
 * The Builder's mark: one four-point sparkle, the glyph the design draws wherever the Builder
 * appears (main sidebar, session header, panel title, builder page). Inside a Button the button's
 * glyph size applies; elsewhere `size` sets it.
 */
export function BuilderIcon({size = 16, ...props}: Omit<LucideProps, "ref">) {
    return <Sparkle size={size} aria-hidden {...props} />
}
