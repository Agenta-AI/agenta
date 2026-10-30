import {InviteAcceptError} from "./states/InviteAcceptError"
import {useInviteAccept} from "./useInviteAccept"

/** Shows nothing while it accepts: the post-auth loader or the next screen takes over. */
export const InviteAcceptScreen = () => {
    const {failure, retry, goBack, switchAccount} = useInviteAccept()
    if (!failure) return <div className="bg-background min-h-dvh" />
    return (
        <InviteAcceptError
            message={failure.message}
            onRetry={failure.retryable ? retry : undefined}
            onGoBack={goBack}
            onSwitchAccount={switchAccount}
        />
    )
}
