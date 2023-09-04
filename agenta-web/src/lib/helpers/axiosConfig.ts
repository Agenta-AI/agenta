import axiosApi from "axios"
import {getErrorMessage, globalErrorHandler} from "./errorHandler"

const axios = axiosApi.create({
    headers: {
        "Content-Type": "application/json",
    },
})

axios.interceptors.response.use(
    (response) => response,
    (error) => {
        // if axios config has _ignoreError set to true, then don't handle error
        if (error.config?._ignoreError) throw error

        let msg = getErrorMessage(error.response?.data?.error || error.response?.data, "")
        if (!msg)
            msg = `${error.response?.statusText ? error.response.statusText + "! " : ""}${
                error.message
            }`
        error.message = msg

        const apiCallUrl: string = error.response.request.responseURL
        if (apiCallUrl && apiCallUrl.endsWith("openapi.json")) {
            globalErrorHandler("Docker container is currently not running. Consider restarting it.")
        } else {
            globalErrorHandler(error)
        }

        throw error
    },
)

export default axios
