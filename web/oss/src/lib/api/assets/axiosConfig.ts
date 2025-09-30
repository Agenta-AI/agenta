import axiosApi, {CanceledError} from "axios"
import {getDefaultStore} from "jotai"
import isObject from "lodash/isObject"
import router from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {getJWT} from "@/oss/services/api"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"

import {getAgentaApiUrl} from "../../helpers/api"
import {getErrorMessage, globalErrorHandler} from "../../helpers/errorHandler"
import {isDemo} from "../../helpers/utils"

export const PERMISSION_ERR_MSG =
    "You don't have permission to perform this action. Please contact your organization admin."

const ENDPOINTS_PROJECT_ID_WHITELIST = ["/api/projects", "/api/profile", "/api/organizations"]
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
        const controller = new AbortController()
        const configuredUri = axios.getUri(config)
        if (!ENDPOINTS_PROJECT_ID_WHITELIST.some((endpoint) => configuredUri.includes(endpoint))) {
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

        if (error.response?.status === 403 && error.config.method !== "get") {
            AlertPopup({
                title: "Permission Denied",
                message: error.response?.data?.detail || PERMISSION_ERR_MSG,
                cancelText: null,
                okText: "Ok",
            }) // Commented out for test environment
            error.message = error.response?.data?.detail || PERMISSION_ERR_MSG
            throw error
        }

        if (error.response?.status === 409) {
            return Promise.reject(error)
        }

        // if axios config has _ignoreError set to true, then don't handle error
        if (error.config?._ignoreError) throw error

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
