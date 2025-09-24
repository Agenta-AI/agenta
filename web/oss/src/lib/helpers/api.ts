import {getEnv} from "./dynamicEnv"

export const getAgentaApiUrl = () => {
    const apiUrl = getEnv("NEXT_PUBLIC_AGENTA_API_URL")

    if (!apiUrl && typeof window !== "undefined") {
        return `${window.location.protocol}//${window.location.hostname}`
    }

    return apiUrl
}
