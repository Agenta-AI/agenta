import {getAgentaWebUrl} from "./api"

const LOCALHOST_OR_IPV4_REGEX =
    /^(localhost|((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?))$/i

const isLocalhostOrIp = (hostname: string): boolean => {
    const normalized = hostname.replace(/^\[|\]$/g, "")
    return LOCALHOST_OR_IPV4_REGEX.test(normalized) || normalized.includes(":")
}

const parseHostnameAndPort = (url: string): {hostname: string; port: string} | null => {
    try {
        const parsed =
            typeof window !== "undefined" ? new URL(url, window.location.origin) : new URL(url)
        return {hostname: parsed.hostname, port: parsed.port}
    } catch {
        return null
    }
}

export const getLocalCookiePortSuffix = (): string => {
    if (typeof window === "undefined") return ""

    const parsedWebUrl = parseHostnameAndPort(getAgentaWebUrl())
    const hostname = parsedWebUrl?.hostname || window.location.hostname
    const port = parsedWebUrl?.port || window.location.port

    if (!port) return ""
    if (!isLocalhostOrIp(hostname)) return ""

    return `_${port}`
}
