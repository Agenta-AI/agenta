import {useState} from "react"

import {cancelSessionExecution} from "@agenta/entities/session"
import {Button} from "@agenta/ui/ui"

/**
 * Cooperative Stop for a turn running on ANOTHER device. It posts the durable cancel command,
 * which reaches the runner directly rather than on its next heartbeat, so the turn ends in
 * seconds and its sandbox stays warm for the next message. The liveness poll confirms — the
 * button unmounts when the session stops reading as running.
 */
export const StopButton = ({sessionId, projectId}: {sessionId: string; projectId: string}) => {
    const [state, setState] = useState<"idle" | "stopping" | "failed">("idle")
    const [staleMessage, setStaleMessage] = useState<string | null>(null)
    const onStop = async () => {
        setState("stopping")
        setStaleMessage(null)
        try {
            // No guard here on purpose. This button stops a turn running on ANOTHER device, so
            // this device never saw its turn metadata and has no id to name. Sending the
            // id of some turn this device watched earlier would refuse a Stop that is correct.
            const outcome = await cancelSessionExecution({sessionId, projectId})
            if (!outcome) setState("failed")
            // A refused Stop is not a broken Stop: the turn this button was offering to stop has
            // already ended and another one holds the session. Say that instead of "try again",
            // which would send the user round the same refusal.
            else if (outcome.conflict) {
                setState("idle")
                setStaleMessage("That run had already ended. The session is running a newer turn.")
            }
        } catch {
            // A rejection (offline, 5xx) must land on "failed" like a null result. Without this
            // the button sits on "Stopping…" forever and the user has no way to retry.
            setState("failed")
        }
    }
    if (state === "stopping") {
        return <p className="text-muted-foreground text-xs">Stopping…</p>
    }
    return (
        <span className="flex items-center gap-2">
            <Button
                variant="destructive-outline"
                className="min-h-11"
                onClick={() => void onStop()}
            >
                Stop
            </Button>
            {state === "failed" ? (
                <span className="text-destructive text-xs">Stop failed — try again.</span>
            ) : null}
            {staleMessage ? (
                <span className="text-muted-foreground text-xs">{staleMessage}</span>
            ) : null}
        </span>
    )
}
