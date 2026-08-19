import {getColorPairFromStr} from "@agenta/ui/components/presentational"

// The categorical avatar set lives in @agenta/ui (the package cannot import from the app, so it
// owns the source); this re-export keeps the app's historic import path working.
export {getColorPairFromStr}

const tagColors = [
    "blue",
    "purple",
    "cyan",
    "green",
    "magenta",
    "pink",
    "red",
    "orange",
    "yellow",
    "volcano",
    "geekblue",
    "lime",
    "gold",
]

export const fadeColor = (hex: string, opacity: number) => {
    // Remove the '#' character if present
    hex = hex.replace(/^#/, "")

    // Parse the hex value into individual RGB components
    const bigint = parseInt(hex, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255

    // Create the faded color in RGBA format
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/**
 * Tailwind classes for a boolean value, kept identical to the pretty JSON view
 * (PrettyJsonView) so True/False read the same wherever they appear.
 */
export const booleanValueColorClass = (value: boolean): string =>
    value ? "text-green-7 dark:text-[var(--ant-green-7)]" : "text-orange-6"

export const getTagColors = () => [...tagColors]
