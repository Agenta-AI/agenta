export interface ColorPair {
    backgroundColor: string
    textColor: string
}

/**
 * The categorical avatar set (recolor spec), assigned in fixed order — flat fills, no gradients.
 * `light-dark()` resolves against the root's `color-scheme`, which the app keeps in sync with the
 * theme, so one pair covers both modes without the package needing a theme context.
 */
const COLOR_PAIRS: ColorPair[] = [
    {backgroundColor: "light-dark(#5E5E08, #D1D151)", textColor: "light-dark(#FFFFFF, #141414)"},
    {backgroundColor: "light-dark(#113955, #8CCFFF)", textColor: "light-dark(#FFFFFF, #113955)"},
    {backgroundColor: "light-dark(#5E0908, #FF8E8C)", textColor: "light-dark(#FFFFFF, #5E0908)"},
    {backgroundColor: "light-dark(#D97757, #EBC96A)", textColor: "light-dark(#FFFFFF, #5E3D00)"},
    {backgroundColor: "light-dark(#54B5FA, #54B5FA)", textColor: "#113955"},
    {backgroundColor: "light-dark(#616161, #BCBCBC)", textColor: "light-dark(#FFFFFF, #333333)"},
]

function hashString(text: string): number {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }
    return hash
}

export function getColorPairFromStr(value: string): ColorPair {
    const index =
        ((hashString(value) % COLOR_PAIRS.length) + COLOR_PAIRS.length) % COLOR_PAIRS.length
    return COLOR_PAIRS[index]
}

export function getInitials(name: string, limit = 2): string {
    try {
        return name
            .split(" ")
            .slice(0, limit)
            .reduce((acc, word) => acc + (word[0] || "").toUpperCase(), "")
    } catch {
        return "?"
    }
}
