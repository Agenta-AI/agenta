export type StopPhase = "idle" | "requesting" | "accepted" | "retryable" | "terminal" | "stopped"

export type StopEvent =
    | {type: "request"}
    | {type: "accepted"}
    | {type: "cancelled"; parked: boolean}
    | {type: "terminal"}
    | {type: "timeout"}
    | {type: "failed" | "already_idle" | "reset"}

export const reduceStopPhase = (phase: StopPhase, event: StopEvent): StopPhase => {
    switch (event.type) {
        case "request":
            return phase === "terminal" ? "terminal" : "requesting"
        case "accepted":
            return phase === "terminal" ? "stopped" : "accepted"
        case "cancelled":
            if (event.parked || phase === "terminal") return "stopped"
            return "accepted"
        case "timeout":
            return phase === "accepted" ? "retryable" : phase
        case "terminal":
            if (phase === "requesting") return "terminal"
            if (phase === "accepted" || phase === "retryable") return "stopped"
            return phase
        case "failed":
        case "already_idle":
        case "reset":
            return "idle"
    }
}

export const isStoppingPhase = (phase: StopPhase): boolean =>
    phase === "requesting" || phase === "accepted" || phase === "terminal"
