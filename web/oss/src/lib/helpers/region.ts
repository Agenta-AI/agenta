import {getEnv} from "./dynamicEnv"

export const REGIONS = {
    eu: {
        id: "eu",
        label: "EU",
        host: "eu.cloud.agenta.ai",
    },
    us: {
        id: "us",
        label: "US",
        host: "us.cloud.agenta.ai",
    },
} as const

export type RegionId = keyof typeof REGIONS

const REGION_COOKIE_KEY = "agenta-cloud-region"

const getRegionFromHostname = (hostname: string): RegionId | null => {
    if (hostname === "us.cloud.agenta.ai") return "us"
    if (hostname === "eu.cloud.agenta.ai" || hostname === "cloud.agenta.ai") return "eu"
    return null
}

export const getCloudRegion = (): RegionId | null => {
    const region = getEnv("NEXT_PUBLIC_AGENTA_CLOUD_REGION")?.toLowerCase()
    if (region === "eu" || region === "us") return region
    if (typeof window === "undefined") return null
    return getRegionFromHostname(window.location.hostname)
}

export const shouldShowRegionSelector = () => {
    if (getCloudRegion()) return true
    if (typeof window === "undefined") return false
    const hostname = window.location.hostname
    return hostname === "cloud.agenta.ai" || hostname.endsWith(".cloud.agenta.ai")
}

export const isCloudAliasHost = () => {
    if (typeof window === "undefined") return false
    return window.location.hostname === "cloud.agenta.ai"
}

export const buildSwitchUrl = (target: RegionId) => {
    if (typeof window === "undefined") return null
    const {protocol, pathname, search, hash} = window.location
    return `${protocol}//${REGIONS[target].host}${pathname}${search}${hash}`
}

const getCookieDomain = (hostname: string) => {
    if (hostname === "cloud.agenta.ai" || hostname.endsWith(".cloud.agenta.ai")) {
        return " Domain=.cloud.agenta.ai;"
    }
    return ""
}

export const getPreferredRegion = (): RegionId | null => {
    if (typeof document === "undefined") return null
    const raw = document.cookie
        .split(";")
        .map((row) => row.trim())
        .find((row) => row.startsWith(`${REGION_COOKIE_KEY}=`))
    if (!raw) return null
    const value = raw.split("=")[1]
    if (value === "eu" || value === "us") return value
    return null
}

export const setPreferredRegion = (region: RegionId) => {
    if (typeof document === "undefined" || typeof window === "undefined") return
    const domain = getCookieDomain(window.location.hostname)
    const secure = window.location.protocol === "https:" ? " Secure;" : ""
    document.cookie = `${REGION_COOKIE_KEY}=${region}; Max-Age=31536000; Path=/; SameSite=Lax;${domain}${secure}`
}
