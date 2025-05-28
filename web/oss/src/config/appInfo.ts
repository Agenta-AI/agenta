import {getEnv} from "../lib/helpers/dynamicEnv"

export const appInfo = {
    appName: "agenta",
    apiDomain: `${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}`,
    websiteDomain: `${getEnv("NEXT_PUBLIC_AGENTA_WEB_URL")}`,
    apiBasePath: "/api/auth",
    websiteBasePath: "/auth",
}
