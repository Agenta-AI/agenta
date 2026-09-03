import {useState} from "react"

import {commandSessionStream} from "@agenta/entities/session"
import {Button} from "@agenta/ui/ui"

/**
 * Cooperative Stop for a running turn: the no-inputs/no-force stream command drops the
 * running locks and the runner aborts on its next heartbeat (≤30s). The liveness poll
 * confirms — the button unmounts when the session stops reading as running. Until
 * feat/agent-cancel-steer lands the turn settles as an error record, not a clean
 * "cancelled"; the copy says so.
 */
export const StopButton = ({sessionId, projectId}: {sessionId: string; projectId: string}) => {
    const [state, setState] = useState<"idle" | "stopping" | "failed">("idle")
    const onStop = async () => {
        setState("stopping")
        try {
            const result = await commandSessionStream({sessionId, projectId})
            if (!result) setState("failed")
        } catch {
            // A rejection (offline, 5xx) must land on "failed" like a null result. Without this
            // the button sits on "Stopping…" forever and the user has no way to retry.
            setState("failed")
        }
    }
    if (state === "stopping") {
        return (
            <p className="text-muted-foreground text-xs">
                Stopping… can take up to 30s; the turn may settle as an error for now.
            </p>
        )
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
        </span>
    )
}
