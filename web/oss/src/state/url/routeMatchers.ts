const TRACE_ENABLED_PATH_MATCHERS = [
    "/observability",
    "/traces",
    "/playground",
    "/evaluations",
] as const
const VARIANT_ENABLED_PATH_MATCHERS = ["/variants", "/overview"] as const

const SESSION_ENABLED_PATH_MATCHERS = ["/observability", "/sessions"] as const

export const isTraceSupportedRoute = (pathname: string) =>
    TRACE_ENABLED_PATH_MATCHERS.some((segment) => pathname.includes(segment))

export const isSessionSupportedRoute = (pathname: string) =>
    SESSION_ENABLED_PATH_MATCHERS.some((segment) => pathname.includes(segment))

export const isVariantSupportedRoute = (pathname: string) =>
    VARIANT_ENABLED_PATH_MATCHERS.some((segment) => pathname.includes(segment))
