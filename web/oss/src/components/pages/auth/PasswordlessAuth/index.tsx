import {PasswordlessRequestForm} from "@agenta/auth-ui"

import {PasswordlessAuthProps} from "../assets/types"
import {useTurnstileSecurity} from "../assets/useTurnstileSecurity"

/** OSS binding over the package form: Turnstile as the security seam, page state mapped 1:1. */
const PasswordlessAuth = ({
    email,
    setEmail,
    message,
    setMessage,
    authErrorMsg,
    setIsLoginCodeVisible,
    disabled,
    lockEmail = false,
}: PasswordlessAuthProps) => {
    const security = useTurnstileSecurity(setMessage)

    return (
        <PasswordlessRequestForm
            email={email}
            setEmail={setEmail}
            message={message}
            setMessage={setMessage}
            onCodeSent={() => setIsLoginCodeVisible(true)}
            onAuthError={authErrorMsg}
            disabled={disabled}
            lockEmail={lockEmail}
            security={security}
        />
    )
}

export default PasswordlessAuth
