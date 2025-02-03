export const appInfo = {
    appName: "agenta",
    apiDomain: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}`,
    websiteDomain: `${process.env.NEXT_PUBLIC_WEBSITE_URL || process.env.NEXT_PUBLIC_AGENTA_API_URL}`,
    apiBasePath: "/api/auth",
    websiteBasePath: "/auth",
}
