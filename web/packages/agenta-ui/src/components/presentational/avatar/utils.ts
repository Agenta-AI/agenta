export interface ColorPair {
    backgroundColor: string
    textColor: string
}

const COLOR_PAIRS: ColorPair[] = [
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
