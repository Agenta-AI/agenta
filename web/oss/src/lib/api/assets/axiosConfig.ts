import axiosApi, {CanceledError} from "axios"
import {getDefaultStore} from "jotai"
import isObject from "lodash/isObject"
import router from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {buildAuthUpgradeMessage} from "@/oss/lib/helpers/authMessages"
import {getJWT} from "@/oss/services/api"
// import {requestNavigationAtom} from "@/oss/state/appState"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"

import {getAgentaApiUrl} from "../../helpers/api"
import {getErrorMessage, globalErrorHandler} from "../../helpers/errorHandler"
import {isDemo} from "../../helpers/utils"

export const PERMISSION_ERR_MSG =
    "You don't have permission to perform this action. Please contact your organization admin."

const ENDPOINTS_PROJECT_ID_WHITELIST = ["/auth/", "/projects", "/profile", "/organizations"]
let authUpgradeRedirectInFlight = false
const resetAuthUpgradeRedirect = () => {
    authUpgradeRedirectInFlight = false
}
const axios = axiosApi.create({
    baseURL: getAgentaApiUrl(),
    headers: {
        "Content-Type": "application/json",
    },
})

axios.interceptors.request.use(async (config) => {
    const fullUri = axios.getUri(config)
    const agentaApiUrl = getAgentaApiUrl()

    // Debug logging for test environment
    if (process.env.NODE_ENV === "test") {
        console.log("🌐 Axios Request Debug:", {
            method: config.method?.toUpperCase(),
            url: config.url,
            baseURL: config.baseURL,
            fullUri,
            agentaApiUrl,
            headers: config.headers,
        })
    }

    if (agentaApiUrl && !fullUri.includes(agentaApiUrl)) {
        config.headers.set("ngrok-skip-browser-warning", true)
    }

    if (!isDemo()) return config
    const jwt = await getJWT()

    const store = getDefaultStore()

    const user = store.get(userAtom) as any | undefined
    const projectId = store.get(projectIdAtom)

    if (!jwt || !user || !projectId) {
        // Check if project_id is explicitly provided in params or URL
        const hasExplicitProjectId =
            config.params?.["project_id"] ||
            config.url?.includes("?project_id=") ||
            config.url?.includes("&project_id=")

        if (hasExplicitProjectId) {
            // If explicit project_id is present, we still need to add the JWT header
            if (jwt) {
                config.headers.set("Authorization", `Bearer ${jwt}`)
            }
            return config
        }

        const controller = new AbortController()
        const configuredUri = axios.getUri(config)
        if (!ENDPOINTS_PROJECT_ID_WHITELIST.some((endpoint) => configuredUri.includes(endpoint))) {
            console.log("ABORTING REQUEST", {
                configuredUri,
                projectId,
                jwt,
                user,
            })
            controller.abort()
        }

        return {
            ...config,
            signal: controller.signal,
        }
    }

    // Add JWT Authorization header (before any early returns)
    if (jwt) {
        config.headers.set("Authorization", `Bearer ${jwt}`)

        if (process.env.NEXT_PUBLIC_LOG_APP_ATOMS === "true") {
            console.log("🔐 Added JWT Authorization header:", `Bearer ${jwt.substring(0, 30)}...`)
        }
    }

    if (
        config.params?.["project_id"] ||
        config.url?.includes("?project_id=") ||
        config.url?.includes("&project_id=")
    ) {
        return config
    }

    if (config.params && !config.params.project_id) {
        config.params.project_id = projectId
    } else if (!config.params) {
        config.params = {project_id: projectId}
    }

    return config
})

axios.interceptors.response.use(
    (response) => {
        const {data} = response
        // Skip transformation for blob responses (e.g., file downloads)
        // Blob is an object but should not be JSON-parsed
        if (data instanceof Blob) {
            return response
        }
        // deep convert all UTC dats to local
        if (data && isObject(data))
            response.data = JSON.parse(JSON.stringify(data), (k, v) => {
                return ["created_at", "updated_at", "timestamp"].includes(k) &&
                    typeof v === "string" &&
                    !v.endsWith("Z")
                    ? v + "Z"
                    : v
            })
        return response
    },
    (error) => {
        if (error instanceof CanceledError) {
            return Promise.reject(error)
        }

        const upgradeDetail = error.response?.data?.detail
        if (
            error.response?.status === 403 &&
            (upgradeDetail?.error === "AUTH_UPGRADE_REQUIRED" ||
                upgradeDetail?.error === "AUTH_SSO_DENIED") &&
            !error.config?._skipAuthUpgradeRedirect
        ) {
            if (typeof window !== "undefined" && window.localStorage.getItem("authUpgradeOrgId")) {
                if (error.config) {
                    error.config._ignoreError = true
                }
                return Promise.reject(error)
            }
            if (typeof window === "undefined") {
                return Promise.reject(error)
            }

            const detailMessage =
                typeof upgradeDetail?.message === "string"
                    ? upgradeDetail.message
                    : "Additional authentication required"
            const required = Array.isArray(upgradeDetail?.required_methods)
                ? upgradeDetail.required_methods
                : []
            const currentIdentity =
                (Array.isArray(upgradeDetail?.session_identities)
                    ? upgradeDetail.session_identities[0]
                    : undefined) ||
                (Array.isArray(upgradeDetail?.user_identities)
                    ? upgradeDetail.user_identities[0]
                    : undefined)

            const store = getDefaultStore()
            const selectedOrgId = store.get(selectedOrgIdAtom)
            if (!authUpgradeRedirectInFlight) {
                authUpgradeRedirectInFlight = true

                // Clear any pending invite to prevent redirect loops.
                // When auth upgrade is required, the user needs to re-authenticate
                // with the correct method, not re-process the invite.
                try {
                    window.localStorage.removeItem("invite")
                } catch {
                    // ignore storage errors
                }

                const message = buildAuthUpgradeMessage(
                    required,
                    currentIdentity,
                    upgradeDetail?.error,
                )
                const authError =
                    upgradeDetail?.error === "AUTH_SSO_DENIED" ? "sso_denied" : "upgrade_required"
                if (upgradeDetail?.error === "AUTH_SSO_DENIED") {
                    signOut().catch(() => null)
                }
                const query = new URLSearchParams({
                    auth_error: authError,
                    auth_message: message,
                })
                if (selectedOrgId) {
                    query.set("organization_id", selectedOrgId)
                }
                const target = `/auth?${query.toString()}`
                router.push(target).catch(() => {
                    window.location.assign(target)
                })
                setTimeout(resetAuthUpgradeRedirect, 2000)
            }

            error.message = detailMessage
            if (error.config) {
                error.config._ignoreError = true
            }
            return Promise.reject(error)
        }

        // if axios config has _ignoreError set to true, then don't handle error
        if (error.config?._ignoreError) throw error

        if (error.response?.status === 403 && error.config.method !== "get") {
            const detail = error.response?.data?.detail
            const detailMessage =
                typeof detail === "string" ? detail : detail?.message || PERMISSION_ERR_MSG
            AlertPopup({
                title: "Permission Denied",
                message: detailMessage,
                cancelText: null,
                okText: "Ok",
            }) // Commented out for test environment
            error.message = detailMessage
            throw error
        }

        const domainDeniedDetail = error.response?.data?.detail
        if (error.response?.status === 403 && domainDeniedDetail?.error === "AUTH_DOMAIN_DENIED") {
            if (error.config) {
                error.config._ignoreError = true
            }
            throw error
        }

        let msg = getErrorMessage(error.response?.data?.error || error.response?.data, "")
        if (!msg)
            msg = `${error.response?.statusText ? error.response.statusText + "! " : ""}${
                error.message
            }`
        error.message = msg

        if (error.response?.status === 401) {
            signOut()
                .then(() => {
                    router.push("/auth")
                })
                .catch(console.error)
        }

        globalErrorHandler(error)

        throw error
    },
)

export default axios
