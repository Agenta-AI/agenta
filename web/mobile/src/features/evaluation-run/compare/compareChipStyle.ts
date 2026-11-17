import type {CSSProperties} from "react"

import {compareColor} from "./compareColor"

/** A run chip in its comparison color: the text and border in the color, a light fill of it. */
export const compareChipStyle = (slot: number): CSSProperties => {
    const color = compareColor(slot)
    return {
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
    }
}
