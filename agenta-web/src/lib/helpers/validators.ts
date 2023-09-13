export function isValidUrl(url: string) {
    try {
        new URL(url)
        return true
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
