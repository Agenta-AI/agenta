import axiosApi from "axios"
import {getErrorMessage, globalErrorHandler} from "./errorHandler"
import {isDemo} from "./utils"
import {signOut} from "supertokens-auth-react/recipe/thirdpartypasswordless"

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

        globalErrorHandler(error)

        // if the user is unauthorized then logout
        if (error.response?.status === 401 && isDemo()) {
            signOut().then(() => {
                window.location.pathname = "/auth"
            })
        }

        throw error
    },
)

export default axios
