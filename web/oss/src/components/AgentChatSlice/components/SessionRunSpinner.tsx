import {CircleNotchIcon} from "@phosphor-icons/react"
import clsx from "clsx"

/** Box the playground's status dot reserves for this, so starting a run swaps the glyph without
 * nudging the label sideways. */
export const SESSION_RUN_GLYPH_PX = 12

/**
 * The one "thinking" animation, shared by the playground's session chips/rail/history and the
 * sidebar's session rows — one glyph and one motion, so a running session reads the same wherever
 * you catch sight of it. Only the size adapts to the surface.
 *
 * `motion-safe` leaves a static notch when the user asks for less motion: still distinct from the
 * idle dot, so the state survives without the spin.
 */
export const SessionRunSpinner = ({size, className}: {size?: number; className?: string}) => (
    <CircleNotchIcon
        size={size ?? SESSION_RUN_GLYPH_PX}
        weight="bold"
        aria-hidden
        // `!` on the colour: antd's `.ant-menu-item .ant-menu-item-icon` rule outranks a plain
        // utility class, which left the sidebar's copy inheriting row text instead of the accent.
        className={clsx("shrink-0 !text-colorInfo motion-safe:animate-spin", className)}
    />
)
