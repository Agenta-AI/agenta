import {EmailPasswordForm} from "@agenta/auth-ui"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"

import {EmailPasswordAuthProps} from "../assets/types"
import {useTurnstileSecurity} from "../assets/useTurnstileSecurity"

/** OSS binding: the sign-up-only variant (invite flows land here with a locked email). */
const EmailPasswordAuth = ({
    message,
    setMessage,
    authErrorMsg,
    initialEmail,
    lockEmail = false,
}: EmailPasswordAuthProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
    const security = useTurnstileSecurity(setMessage)

    return (
        <EmailPasswordForm
            mode="sign-up"
            message={message}
            setMessage={setMessage}
            initialEmail={initialEmail}
            lockEmail={lockEmail}
            security={security}
            onAuthError={authErrorMsg}
            onSuccess={async (payload) => {
                await handleAuthSuccess(payload, {authMethod: "email"})
            }}
        />
    )
}

export default EmailPasswordAuth
