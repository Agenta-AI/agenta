export const withAlpha = (color: string, alpha: number) => {
    if (color.startsWith("#")) {
        const hex = color.slice(1)
        const normalized =
            hex.length === 3
                ? hex
                      .split("")
                      .map((ch) => ch + ch)
                      .join("")
                : hex
        const int = Number.parseInt(normalized, 16)
        if (!Number.isNaN(int)) {
            const r = (int >> 16) & 255
            const g = (int >> 8) & 255
            const b = int & 255
            return `rgba(${r}, ${g}, ${b}, ${alpha})`
        }
    }
    return color
}

export const format3Sig = (n: number) => {
    if (!Number.isFinite(n)) return String(n)
    const abs = Math.abs(n)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return n.toExponential(2)
    const s = n.toPrecision(3)
    return String(Number(s))
}

export const formatTimestamp = (value: number) => {
    if (!Number.isFinite(value)) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}
