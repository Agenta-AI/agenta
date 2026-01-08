import {useEffect, useRef, useState} from "react"

import {Alert, Spin} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import Session from "supertokens-auth-react/recipe/session"
import {signInAndUp} from "supertokens-auth-react/recipe/thirdparty"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {AuthErrorMsgType} from "@/oss/lib/Types"
import {mergeSessionIdentities} from "@/oss/services/auth/api"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

const Auth = dynamic(() => import("../[[...path]]"), {ssr: false})

const Callback = () => {
    const router = useRouter()
    const [message, setMessage] = useState<AuthErrorMsgType>({} as AuthErrorMsgType)
    const {handleAuthSuccess} = usePostAuthRedirect()
    const hasHandledCallback = useRef(false)

    const state = router.query.state as string
    const code = router.query.code as string

    const handleAuthError = (err: unknown) => {
        if ((err as any)?.isSuperTokensGeneralError === true) {
            setMessage({message: (err as any).message, type: "error"})
        } else if (isBackendAvailabilityIssue(err)) {
            setMessage({
                message:
                    "Unable to connect to the authentication service. Please check if the backend is running and accessible.",
                type: "error",
            })
        } else {
            setMessage({
                message: "Oops, something went wrong. Please try again",
                type: "error",
            })
        }
    }

    const handleThirdPartyCallback = async () => {
        if (hasHandledCallback.current) {
            return
        }
        hasHandledCallback.current = true
        try {
            console.log("[AUTH-CALLBACK] Starting third-party callback", {
                path: window.location.pathname,
                query: window.location.search,
                state,
                code,
            })
            const response = await signInAndUp()

            if (response.status === "OK") {
                console.log("[AUTH-CALLBACK] signInAndUp OK", response)
                try {
                    const payload = await Session.getAccessTokenPayloadSecurely()
                    console.log("[AUTH-CALLBACK] session payload", payload)
                } catch (payloadErr) {
                    console.warn("[AUTH-CALLBACK] session payload fetch failed", payloadErr)
                }
                if (typeof window !== "undefined") {
                    const rawSessionIdentities = window.localStorage.getItem(
                        "authUpgradeSessionIdentities",
                    )
                    if (rawSessionIdentities) {
                        try {
                            const parsed = JSON.parse(rawSessionIdentities)
                            const list = Array.isArray(parsed) ? parsed : []
                            if (list.length > 0) {
                                await mergeSessionIdentities(list)
                            }
                            window.localStorage.removeItem("authUpgradeSessionIdentities")
                        } catch (mergeError) {
                            console.warn(
                                "[AUTH-CALLBACK] session identities merge failed",
                                mergeError,
                            )
                        }
                    }
                }
                setMessage({message: "Verification successful", type: "success"})
                const {createdNewRecipeUser, user} = response
                await handleAuthSuccess({createdNewRecipeUser, user})
            } else if (response.status === "SIGN_IN_UP_NOT_ALLOWED") {
                console.warn("[AUTH-CALLBACK] signInAndUp not allowed", response)
                setMessage({message: response.reason, type: "error"})
                await router.push("/auth")
            } else {
                console.warn("[AUTH-CALLBACK] signInAndUp no email", response)
                setMessage({
                    message: "No email provided by social login. Please use another form of login",
                    type: "error",
                })
                await router.push("/auth")
            }
        } catch (err: any) {
            console.error("[AUTH-CALLBACK] signInAndUp error", err)
            handleAuthError(err)
        }
    }

    useEffect(() => {
        console.log("[AUTH-CALLBACK] Router ready check", {
            isReady: router.isReady,
            state,
            code,
        })
        if (router.isReady && !state && !code) {
            ;(async () => {
                const context = await waitForWorkspaceContext()
                const nextPath = buildPostLoginPath(context)
                console.log("[AUTH-CALLBACK] No state/code; redirecting", {
                    nextPath,
                })
                router.replace(nextPath)
            })()
        }
    }, [state, code, router.isReady])

    useEffect(() => {
        if (window.location.pathname.startsWith("/auth/callback/")) {
            console.log("[AUTH-CALLBACK] Detected callback path", {
                path: window.location.pathname,
            })
            handleThirdPartyCallback()
        }
    }, [])

    useLazyEffect(() => {
        if (message.message) {
            setTimeout(() => {
                setMessage({} as AuthErrorMsgType)
            }, 5000)
        }
    }, [message])

    return (
        <>
            <Spin spinning={true} className="!max-h-screen">
                <Auth />
            </Spin>

            {message.message && (
                <Alert
                    showIcon
                    closable
                    message={message.message}
                    type={message.type}
                    className="absolute bottom-6 right-6 z-50"
                />
            )}
        </>
    )
}

export default Callback
