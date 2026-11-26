import {Button} from "@agenta/ui/ui"

import {AgentaLogo} from "@/components/AgentaLogo"

export const InviteAcceptError = ({
    message,
    onRetry,
    onGoBack,
    onSwitchAccount,
}: {
    message: string
    /** Offered only when the same request may succeed. */
    onRetry?: () => void
    onGoBack: () => void
    onSwitchAccount: () => void
}) => (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
        <AgentaLogo className="text-foreground h-6 w-auto" />
        <div className="flex max-w-md flex-col gap-2" role="alert">
            <h1 className="text-base font-medium">Unable to accept invitation</h1>
            <p className="text-muted-foreground text-sm">{message}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
            {onRetry ? (
                <Button type="button" variant="outline" onClick={onRetry}>
                    Retry
                </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onGoBack}>
                Go back to your workspaces
            </Button>
            <Button type="button" onClick={onSwitchAccount}>
                Sign in with a different account
            </Button>
        </div>
    </div>
)
