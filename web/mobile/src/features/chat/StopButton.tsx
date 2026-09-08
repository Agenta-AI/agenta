import {useState} from "react"

import {cancelSessionExecution} from "@agenta/entities/session"
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
            const outcome = await cancelSessionExecution({sessionId, projectId})
            if (!outcome) setState("failed")
            if (outcome && !outcome.conflict && outcome.execution.state === "idle") setState("idle")
            // A conflict means another execution replaced the offered turn.
            if (outcome?.conflict) {
                setState("idle")
                setStaleMessage(
                    "That run had already finished. The session is running something else now.",
                )
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
