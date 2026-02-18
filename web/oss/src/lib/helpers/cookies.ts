const LOCALHOST_OR_IPV4_REGEX =
    /^(localhost|((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?))$/i

const isLocalhostOrIp = (hostname: string): boolean => {
    const normalized = hostname.replace(/^\[|\]$/g, "")
    return LOCALHOST_OR_IPV4_REGEX.test(normalized) || normalized.includes(":")
}

export const getLocalCookiePortSuffix = (): string => {
    if (typeof window === "undefined") return ""

    const {hostname, port} = window.location
    if (!port) return ""
    if (!isLocalhostOrIp(hostname)) return ""

    return `_${port}`
}
