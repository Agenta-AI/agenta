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

const colorPairs = [
    {backgroundColor: "#BAE0FF", textColor: "#1677FF"},
    {backgroundColor: "#D9F7BE", textColor: "#389E0D"},
    {backgroundColor: "#efdbff", textColor: "#722ED1"},
    {backgroundColor: "#fff1b8", textColor: "#AD6800"},
    {backgroundColor: "#D1F5F1", textColor: "#13C2C2"},
    {backgroundColor: "#ffd6e7", textColor: "#EB2F96"},
    {backgroundColor: "#f7cfcf", textColor: "#D61010"},
    {backgroundColor: "#eaeff5", textColor: "#758391"},
    {backgroundColor: "#D1E4E8", textColor: "#5E7579"},
    {backgroundColor: "#F5E6D3", textColor: "#825E31"},
    {backgroundColor: "#F9F6C1", textColor: "#84803A"},
    {backgroundColor: "#F4E6E4", textColor: "#9C706A"},
]

export const getGradientFromStr = (value: string) => {
    return gradients[stringToNumberInRange(value, 0, gradients.length - 1)]
}

export const getColorPairFromStr = (value: string) => {
    const index = stringToNumberInRange(value, 0, colorPairs.length - 1)
    return colorPairs[index]
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

export const getTagColors = () => [...tagColors]

export const getRandomColors = () => colorPairs.map((color) => color.textColor)
