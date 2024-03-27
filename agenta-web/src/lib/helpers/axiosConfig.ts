import axiosApi from "axios"
import {getErrorMessage, globalErrorHandler} from "./errorHandler"
import {signOut} from "supertokens-auth-react/recipe/thirdpartypasswordless"
import router from "next/router"
import {getAgentaApiUrl} from "./utils"
import {isObject} from "lodash"
import AlertPopup from "@/components/AlertPopup/AlertPopup"

export const PERMISSION_ERR_MSG =
    "You don't have permission to perform this action. Please contact your organization admin."

const axios = axiosApi.create({
    baseURL: getAgentaApiUrl(),
    headers: {
        "Content-Type": "application/json",
    },
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
