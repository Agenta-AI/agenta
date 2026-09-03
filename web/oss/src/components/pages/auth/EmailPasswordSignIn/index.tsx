import {EmailPasswordForm} from "@agenta/auth-ui"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"

import {EmailPasswordAuthProps} from "../assets/types"
import {useTurnstileSecurity} from "../assets/useTurnstileSecurity"

/** OSS binding: sign-in with the sign-up fallback, Turnstile seam, app-side redirect. */
const EmailPasswordSignIn = ({
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

export default EmailPasswordSignIn
