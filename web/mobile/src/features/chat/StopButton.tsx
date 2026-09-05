import {useState} from "react"

import {cancelSessionStream} from "@agenta/entities/session"
import {Button} from "@agenta/ui/ui"

/** Cooperative Stop stays pending until shared liveness removes the control. */
export const StopButton = ({sessionId, projectId}: {sessionId: string; projectId: string}) => {
    const [state, setState] = useState<"idle" | "stopping" | "failed">("idle")
    const [staleMessage, setStaleMessage] = useState<string | null>(null)
    const onStop = async () => {
        setState("stopping")
        setStaleMessage(null)
        try {
            // Cross-device Stop has no locally observed execution id to guard with.
            const outcome = await cancelSessionStream({sessionId, projectId})
            if (outcome.status === "failed") setState("failed")
            if (outcome.status === "idle") setState("idle")
            // A stale response means another execution replaced the offered turn.
            if (outcome.status === "stale") {
                setState("idle")
                setStaleMessage(outcome.message)
            }
        } catch {
            // Network rejection must leave Stop retryable.
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
            {staleMessage ? (
                <span className="text-muted-foreground text-xs">{staleMessage}</span>
            ) : null}
        </span>
    )
}
