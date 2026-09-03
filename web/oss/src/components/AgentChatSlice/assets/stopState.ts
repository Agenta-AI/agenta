export type StopPhase = "idle" | "requesting" | "accepted" | "terminal" | "stopped"

export type StopEvent =
    | {type: "request"}
    | {type: "accepted"}
    | {type: "terminal"}
    | {type: "failed" | "already_idle" | "reset"}

export const reduceStopPhase = (phase: StopPhase, event: StopEvent): StopPhase => {
    switch (event.type) {
        case "request":
            return "requesting"
        case "accepted":
            return phase === "terminal" ? "stopped" : "accepted"
        case "terminal":
            if (phase === "requesting") return "terminal"
            if (phase === "accepted") return "stopped"
            return phase
        case "failed":
        case "already_idle":
        case "reset":
            return "idle"
    }
}

export const isStoppingPhase = (phase: StopPhase): boolean =>
    phase === "requesting" || phase === "accepted" || phase === "terminal"
