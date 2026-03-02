/**
 * Cloud region helpers.
 *
 * All host-awareness lives here. Region is derived from the current hostname
 * so there is no env-var to configure. Each "cloud environment" pairs an EU
 * host with a US host (and an optional alias that auto-redirects).
 */

// ---------------------------------------------------------------------------
// Region definitions
// ---------------------------------------------------------------------------

export const REGIONS = {
    eu: {label: "EU", location: "Frankfurt, Germany"},
    us: {label: "US", location: "Ohio, United States"},
} as const

export type RegionId = keyof typeof REGIONS

// ---------------------------------------------------------------------------
// Cloud environments
// ---------------------------------------------------------------------------

interface CloudEnv {
    eu: string
    us: string
    alias?: string
    cookieDomain: string
}

const CLOUD_ENVIRONMENTS: CloudEnv[] = [
    {
        eu: "eu.cloud.agenta.ai",
        us: "us.cloud.agenta.ai",
        alias: "cloud.agenta.ai",
        cookieDomain: ".cloud.agenta.ai",
    },
    {
        eu: "staging.preview.agenta.dev",
        us: "testing.preview.agenta.dev",
        cookieDomain: ".preview.agenta.dev",
    },
]

// ---------------------------------------------------------------------------
// Host classification (single source of truth)
// ---------------------------------------------------------------------------

interface HostInfo {
    region: RegionId
    env: CloudEnv
}

const classifyHost = (hostname: string): HostInfo | null => {
    for (const env of CLOUD_ENVIRONMENTS) {
        if (hostname === env.eu || hostname === env.alias) return {region: "eu", env}
        if (hostname === env.us) return {region: "us", env}
    }
    return null
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Current region derived from hostname, or null if not a cloud host. */
export const getCloudRegion = (): RegionId | null => {
    if (typeof window === "undefined") return null
    return classifyHost(window.location.hostname)?.region ?? null
}

/** Whether the region selector should be rendered. */
export const shouldShowRegionSelector = (): boolean => {
    if (typeof window === "undefined") return false
    return classifyHost(window.location.hostname) !== null
}

/** Whether the current host is an alias that should auto-redirect. */
export const isCloudAliasHost = (): boolean => {
    if (typeof window === "undefined") return false
    const hostname = window.location.hostname
    return CLOUD_ENVIRONMENTS.some((env) => env.alias !== undefined && hostname === env.alias)
}

/** Build a URL that switches to `target` region within the same environment. */
export const buildSwitchUrl = (target: RegionId): string | null => {
    if (typeof window === "undefined") return null
    if (!(target in REGIONS)) return null

    const info = classifyHost(window.location.hostname)
    if (!info) return null

    const targetHost = info.env[target]
    const {protocol, pathname, search, hash} = window.location
    return `${protocol}//${targetHost}${pathname}${search}${hash}`
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const REGION_COOKIE_KEY = "agenta-cloud-region"

export const getPreferredRegion = (): RegionId | null => {
    if (typeof document === "undefined") return null
    const match = document.cookie
        .split(";")
        .map((row) => row.trim())
        .find((row) => row.startsWith(`${REGION_COOKIE_KEY}=`))
    if (!match) return null
    const value = match.substring(match.indexOf("=") + 1)
    if (value === "eu" || value === "us") return value
    return null
}

export const setPreferredRegion = (region: RegionId): void => {
    if (typeof document === "undefined" || typeof window === "undefined") return
    const info = classifyHost(window.location.hostname)
    const domain = info ? ` Domain=${info.env.cookieDomain};` : ""
    const secure = window.location.protocol === "https:" ? " Secure;" : ""
    document.cookie = `${REGION_COOKIE_KEY}=${region}; Max-Age=31536000; Path=/; SameSite=Lax;${domain}${secure}`
}
