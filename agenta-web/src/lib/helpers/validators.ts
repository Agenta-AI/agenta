export const isValidHttpUrl = (url: string) => {
    try {
        const newUrl = new URL(url)
        return newUrl.protocol.startsWith("http")
    } catch (_) {
        return false
    }
}

export function isValidRegex(regex: string) {
    try {
        new RegExp(regex)
        return true
    } catch (_) {
        return false
    }
}
