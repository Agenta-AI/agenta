const TRACE_ENABLED_PATH_MATCHERS = ["/observability", "/traces", "/playground"] as const
const VARIANT_ENABLED_PATH_MATCHERS = ["/variants", "/deployments", "/overview"] as const

export const isTraceSupportedRoute = (pathname: string) =>
    TRACE_ENABLED_PATH_MATCHERS.some((segment) => pathname.includes(segment))

export const isVariantSupportedRoute = (pathname: string) =>
    VARIANT_ENABLED_PATH_MATCHERS.some((segment) => pathname.includes(segment))
