import {useRef} from "react"

import {SocialAuthButtons} from "@agenta/auth-ui"
import {useRouter} from "next/router"
import {getAuthorisationURLWithQueryParamsAndSetState} from "supertokens-auth-react/recipe/thirdparty"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

import {SocialAuthProps} from "../assets/types"

/** OSS binding: the buttons come from the package; the redirect transport stays app-side. */
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

    return (
        <SocialAuthButtons
            providers={providers}
            onSelect={(providerId) => void providerSignInClicked(providerId)}
            isLoading={isLoading}
            disabled={disabled}
            variant={variant}
            yellow={yellow}
            lastUsed={lastUsed}
        />
    )
}

export default SocialAuth
