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
        let msg = getErrorMessage(error.response?.data?.error || error.response?.data, "")
        if (!msg)
            msg = `${error.response?.statusText ? error.response.statusText + "! " : ""}${
                error.message
            }`
        error.message = msg

        globalErrorHandler(error)
        throw error
    },
)

export default axios
