import {stringToNumberInRange} from "./utils"

const gradients = [
    "linear-gradient(to bottom right, #424242, #9F1239, #560BAD)",
    "linear-gradient(to bottom right, #C6F6D5, #34D399, #3B82F6)",
    "linear-gradient(to bottom right, #FEEBC8, #F59E0B, #9A3412)",
    "linear-gradient(to bottom right, #C6F6D5, #22D3EE, #7137F1)",
    "linear-gradient(to bottom right, #BFDBFE, #60A5FA, #3B82F6)",
    "linear-gradient(to bottom right, #8B5CF6, #FDE047)",
    "linear-gradient(to bottom right, #B91C1C, #D97706, #F59E0B)",
    "linear-gradient(to bottom right, #93C5FD, #C6F6D5, #FDE047)",
    "linear-gradient(to bottom right, #3B82F6, #1D4ED8, #111827)",
    "linear-gradient(to bottom right, #34D399, #A78BFA)",
    "linear-gradient(to bottom right, #FEEBC8, #F9A8D4, #F43F5E)",
    "linear-gradient(to bottom right, #10B981, #047857)",
    "linear-gradient(to bottom right, #F472B6, #D946EF, #4F46E5)",
    "linear-gradient(to bottom right, #60A5FA, #3B82F6)",
]

const colors = [
    "#FF5733",
    "#00AABB",
    "#FFC300",
    "#FF0066",
    "#22DD55",
    "#FF3399",
    "#FF9900",
    "#44FFAA",
    "#FF3366",
    "#0088FF",
    "#FFCC00",
    "#DD33FF",
    "#33FF99",
    "#FF0033",
    "#55AAFF",
    "#FF6600",
    "#FF00CC",
    "#11FF44",
    "#FF9933",
    "#0099FF",
]

export const getGradientFromStr = (value: string) => {
    return gradients[stringToNumberInRange(value, 0, gradients.length - 1)]
}

export const getColorFromStr = (value: string) => {
    return colors[stringToNumberInRange(value, 0, colors.length - 1)]
}

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
