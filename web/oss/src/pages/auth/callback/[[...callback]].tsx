import {useEffect, useState} from "react"

import {Alert, Spin} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {signInAndUp} from "supertokens-auth-react/recipe/thirdparty"
import {useLocalStorage} from "usehooks-ts"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {isDemo} from "@/oss/lib/helpers/utils"
import {AuthErrorMsgType} from "@/oss/lib/Types"
import {selectedOrgIdAtom} from "@/oss/state/org"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {waitForValidURL} from "@/oss/state/url"

const Auth = dynamic(() => import("../[[...path]]"), {ssr: false})

const Callback = () => {
    const {reset: resetProfileData} = useProfileData()
    const {reset: resetOrgData} = useOrgData()
    const {reset: resetProjectData} = useProjectData()
    const router = useRouter()
    const [message, setMessage] = useState<AuthErrorMsgType>({} as AuthErrorMsgType)
    const setSelectedOrgId = useSetAtom(selectedOrgIdAtom)

    const [invite] = useLocalStorage("invite", {})
    const isInvitedUser = invite && Object.keys(invite).length > 0

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

    const handleGoogleCallback = async () => {
        try {
            const response = await signInAndUp()

            if (response.status === "OK") {
                resetProfileData()
                resetOrgData()
                resetProjectData()
                // Clear selected org via atom to keep storage in sync
                setSelectedOrgId(null)
                setMessage({message: "Verification successful", type: "success"})
                const isNewUser =
                    isDemo() &&
                    response.createdNewRecipeUser &&
                    response.user.loginMethods.length === 1

                if (isNewUser) {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept?survey=true")
                    } else {
                        await router.push("/post-signup")
                    }
                } else {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept")
                    } else {
                        const url = await waitForValidURL({requireProject: true})
                        await router.push(url.baseAppURL)
                    }
                }
            } else if (response.status === "SIGN_IN_UP_NOT_ALLOWED") {
                setMessage({message: response.reason, type: "error"})
                await router.push("/auth")
            } else {
                setMessage({
                    message: "No email provided by social login. Please use another form of login",
                    type: "error",
                })
                await router.push("/auth")
            }
        } catch (err: any) {
            handleAuthError(err)
        }
    }

    const handleGitHubCallback = async () => {
        try {
            const response = await signInAndUp()

            if (response.status === "OK") {
                resetProfileData()
                resetOrgData()
                resetProjectData()
                setMessage({message: "Verification successful", type: "success"})
                const isNewUser =
                    isDemo() &&
                    response.createdNewRecipeUser &&
                    response.user.loginMethods.length === 1

                if (isNewUser) {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept?survey=true")
                    } else {
                        await router.push("/post-signup")
                    }
                } else {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept")
                    } else {
                        const url = await waitForValidURL({requireProject: true})
                        await router.push(url.baseAppURL)
                    }
                }
            } else if (response.status === "SIGN_IN_UP_NOT_ALLOWED") {
                setMessage({message: response.reason, type: "error"})
                await router.push("/auth")
            } else {
                setMessage({
                    message: "No email provided by social login. Please use another form of login",
                    type: "error",
                })
                await router.push("/auth")
            }
        } catch (err: any) {
            handleAuthError(err)
        }
    }

    useEffect(() => {
        if (router.isReady && !state && !code) {
            ;(async () => {
                const url = await waitForValidURL({requireProject: true})
                router.push(url.baseAppURL)
            })()
        }
    }, [state, code, router.isReady])

    useEffect(() => {
        if (window.location.pathname === "/auth/callback/google") {
            handleGoogleCallback()
        }

        if (window.location.pathname === "/auth/callback/github") {
            handleGitHubCallback()
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
