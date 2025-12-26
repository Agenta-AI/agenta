import {useRef} from "react"

import {Button, Divider} from "antd"
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
    showDivider = true,
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
                        icon={provider.icon}
                        size="large"
                        className="w-full"
                        onClick={() => providerSignInClicked(provider.id)}
                        loading={isLoading}
                        disabled={disabled}
                    >
                        Continue with {provider.label}
                    </Button>
                ))}
            </div>

            {showDivider && <Divider className="!m-0">or</Divider>}
        </>
    )
}

export default SocialAuth
