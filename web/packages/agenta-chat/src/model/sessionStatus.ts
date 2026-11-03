export type SessionRunStatus = "idle" | "running" | "awaiting" | "error"

export interface SessionRunStatusInputs {
    error: boolean
    hitlPending: boolean
    busy: boolean
}

// Precedence error > awaiting approval > running > idle.
export const deriveSessionRunStatus = ({
    error,
    hitlPending,
    busy,
}: SessionRunStatusInputs): SessionRunStatus =>
    error ? "error" : hitlPending ? "awaiting" : busy ? "running" : "idle"
