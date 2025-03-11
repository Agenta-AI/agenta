import axiosApi from "axios"
import isObject from "lodash/isObject"
import router from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {getProfileValues} from "@/oss/contexts/profile.context"
import {getCurrentProject, DEFAULT_UUID} from "@/oss/contexts/project.context"
import {getJWT} from "@/oss/services/api"

import {getErrorMessage, globalErrorHandler} from "../../helpers/errorHandler"
import {getAgentaApiUrl, isDemo} from "../../helpers/utils"

export const PERMISSION_ERR_MSG =
    "You don't have permission to perform this action. Please contact your organization admin."

const axios = axiosApi.create({
    baseURL: getAgentaApiUrl(),
    headers: {
        "Content-Type": "application/json",
    },
})

axios.interceptors.request.use(async (config) => {
    const fullUri = axios.getUri(config)
    const agentaApiUrl = getAgentaApiUrl()

    if (agentaApiUrl && !fullUri.includes(agentaApiUrl)) {
        config.headers.set("ngrok-skip-browser-warning", true)
    }

    if (!isDemo()) return config
    const jwt = await getJWT()

    const profile = getProfileValues()

    const {projectId} = getCurrentProject()

    if (
        !jwt ||
        !profile.user ||
        projectId === DEFAULT_UUID ||
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
        if (error.response?.status === 403 && error.config.method !== "get") {
            AlertPopup({
                title: "Permission Denied",
                message: PERMISSION_ERR_MSG,
                cancelText: null,
                okText: "Ok",
            })
            error.message = PERMISSION_ERR_MSG
            throw error
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
