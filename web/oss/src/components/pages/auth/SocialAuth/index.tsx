import {useRef} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
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

    const hasAnyProvider = providers.length > 0

    if (!hasAnyProvider) {
        return null
    }

    return (
        <>
            <div className="flex flex-col gap-2">
                {providers.map((provider) => (
                    <Button
                        key={provider.id}
                        className="w-full"
                        onClick={() => providerSignInClicked(provider.id)}
                        disabled={disabled || isLoading}
                        variant="outline"
                        size="lg"
                    >
                        {isLoading ? <Spinner /> : null}
                        {provider.icon}
                        Continue with {provider.label}
                    </Button>
                ))}
            </div>
        </>
    )
}

export default SocialAuth
