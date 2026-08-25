import {OtpVerifyForm} from "@agenta/auth-ui"

import {clearPersistedQueryCache} from "@agenta/shared/api/persist"
import {useSetAtom} from "jotai"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {authFlowAtom} from "@/oss/state/session"

import {SendOTPProps} from "../assets/types"

const SendOTP = ({
    message,
    email,
    setMessage,
    authErrorMsg,
    setIsLoginCodeVisible,
    isInvitedUser,
}: SendOTPProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
    const setAuthFlow = useSetAtom(authFlowAtom)

    return (
        <OtpVerifyForm
            email={email}
            message={message}
            setMessage={setMessage}
            onSubmitStart={() => setAuthFlow("authing")}
            onFail={() => setAuthFlow("unauthed")}
            onSuccess={async (payload) => {
                await clearPersistedQueryCache()
                await handleAuthSuccess(
                    {
                        createdNewRecipeUser: payload.createdNewRecipeUser,
                        user: payload.user,
                    },
                    {isInvitedUser, authMethod: "email"},
                )
            }}
            onRestart={async () => {
                await clearPersistedQueryCache()
                setIsLoginCodeVisible(false)
            }}
            onAuthError={authErrorMsg}
        />
    )
}

export default SendOTP