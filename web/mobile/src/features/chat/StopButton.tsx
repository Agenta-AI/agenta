import {useState} from "react"

import {cancelSessionStream} from "@agenta/entities/session"
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
    const [failureMessage, setFailureMessage] = useState<string | null>(null)
    const onStop = async () => {
        setState("stopping")
        setFailureMessage(null)
        try {
            // No guard here on purpose. This button stops a turn running on ANOTHER device, so
            // this device never saw its turn metadata and has no id to name. Sending the
            // id of some turn this device watched earlier would refuse a Stop that is correct.
            const outcome = await cancelSessionStream({sessionId, projectId})
            if (outcome.status === "idle") {
                setState("idle")
                return
            }
            if (outcome.status === "failed" || outcome.status === "stale") {
                setState("failed")
                setFailureMessage(outcome.message)
            }
        } catch (error) {
            // A rejection (offline, 5xx) must land on "failed" like a null result. Without this
            // the button sits on "Stopping…" forever and the user has no way to retry.
            setState("failed")
            setFailureMessage(error instanceof Error ? error.message : "Stop failed — try again.")
        }
    }
    return (
        <span className="flex items-center gap-2">
            <Button
                variant="destructive-outline"
                className="min-h-11"
                onClick={() => void onStop()}
                disabled={state === "stopping"}
            >
                {state === "stopping" ? "Stopping" : "Stop"}
            </Button>
            {state === "failed" ? (
                <span className="text-destructive text-xs">
                    {failureMessage ?? "Stop failed — try again."}
                </span>
            ) : null}
        </span>
    )
}
