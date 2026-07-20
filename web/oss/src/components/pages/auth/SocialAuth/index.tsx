import {useRef} from "react"

import clsx from "clsx"
import {useRouter} from "next/router"
import {getAuthorisationURLWithQueryParamsAndSetState} from "supertokens-auth-react/recipe/thirdparty"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

import {SocialAuthProps} from "../assets/types"

const SocialAuth = ({
    authErrorMsg,
    isLoading,
    setIsLoading,
    disabled,
    providers,
    variant = "default",
    yellow = false,
    lastUsed = false,
}: SocialAuthProps) => {
    const router = useRouter()
    const inFlight = useRef(false)

    const providerSignInClicked = async (providerId: string) => {
        try {
            if (disabled || isLoading || inFlight.current) return
            inFlight.current = true
            setIsLoading(true)

            const authUrl = await getAuthorisationURLWithQueryParamsAndSetState({
                thirdPartyId: providerId,
                frontendRedirectURI: `${
                    getEnv("NEXT_PUBLIC_AGENTA_WEB_URL") || getEnv("NEXT_PUBLIC_AGENTA_API_URL")
                }/auth/callback/${providerId}`,
            })
            await router.push(authUrl)
        } catch (err) {
            authErrorMsg(err)
            setIsLoading(false)
            inFlight.current = false
        }
    }

    if (providers.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-[10px]">
            {providers.map((provider) => (
                <button
                    key={provider.id}
                    type="button"
                    className={clsx(
                        "relative",
                        yellow
                            ? "auth-btn-yellow"
                            : clsx(
                                  "auth-surface-btn",
                                  variant === "promoted" && "auth-surface-btn-promoted",
                              ),
                    )}
                    onClick={() => providerSignInClicked(provider.id)}
                    disabled={disabled || isLoading}
                >
                    {provider.icon}
                    <span>Continue with {provider.label}</span>
                    {lastUsed && (
                        <span className="auth-last-used-tag absolute right-3">Last used</span>
                    )}
                </button>
            ))}
        </div>
    )
}

export default SocialAuth
