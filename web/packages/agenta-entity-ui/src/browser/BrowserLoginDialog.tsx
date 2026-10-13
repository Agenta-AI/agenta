import {Button, Spinner} from "@agenta/ui/ui"

import {BrowserLiveDialog} from "./BrowserLiveDialog"
import type {BrowserLoginState} from "./useBrowserLogin"

export const BrowserLoginDialog = ({
    state,
    onDone,
    onCancel,
}: {
    state: BrowserLoginState
    onDone: () => void
    onCancel: () => void
}) => {
    const profile = state.phase === "idle" ? null : state.profile
    const busy = state.phase === "live" && state.busy
    const error = state.phase === "live" ? state.error : null

    return (
        <BrowserLiveDialog
            open={state.phase !== "idle"}
            onOpenChange={(next) => {
                if (!next && !busy) onCancel()
            }}
            title={profile ? `Log in: ${profile.name}` : "Log in"}
            description={
                <>
                    Sign in to {profile?.allowed_hosts.join(", ") || "your sites"}, then select
                    Done. The browser only opens the sites you listed. Agenta stores the cookies,
                    never your password.
                </>
            }
            target={state.phase === "live" ? {kind: "login", profileId: state.profile.id} : null}
            autoTakeControl
            placeholder={
                state.phase === "failed" ? (
                    <span role="alert" className="text-destructive">
                        {state.error}
                    </span>
                ) : (
                    <span className="flex flex-col items-center gap-3">
                        <Spinner />
                        Starting the browser…
                    </span>
                )
            }
            footer={
                <>
                    {error ? (
                        <p
                            role="alert"
                            className="text-destructive m-0 mr-auto self-center text-xs"
                        >
                            {error}
                        </p>
                    ) : null}
                    <Button variant="outline" disabled={busy} onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button disabled={state.phase !== "live" || busy} onClick={onDone}>
                        {busy ? "Saving…" : "Done"}
                    </Button>
                </>
            }
        />
    )
}
