import type {CSSProperties} from "react"

import {compareColor} from "./compareColor"

/** A run chip in its comparison color; the text keeps the foreground color for contrast. */
export const compareChipStyle = (slot: number): CSSProperties => {
    const color = compareColor(slot)
    return {
        borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
    }
}
