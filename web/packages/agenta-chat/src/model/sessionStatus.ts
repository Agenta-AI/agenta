// Copied verbatim from web/oss/src/components/AgentChatSlice/state/sessions.ts (2026-07-25); the
// OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it. Keep
// byte-parity if either side changes.
export type SessionRunStatus = "idle" | "running" | "awaiting" | "error"

export interface SessionRunStatusInputs {
    error: boolean
    hitlPending: boolean
    busy: boolean
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx (2026-07-25);
// the OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it.
// Keep byte-parity if either side changes. Adapted only to take {error, hitlPending, busy} as a
// parameter object instead of reading them off component-scope hook state.
// Precedence error > awaiting approval > running > idle.
export const deriveSessionRunStatus = ({
    error,
    hitlPending,
    busy,
}: SessionRunStatusInputs): SessionRunStatus =>
    error ? "error" : hitlPending ? "awaiting" : busy ? "running" : "idle"
