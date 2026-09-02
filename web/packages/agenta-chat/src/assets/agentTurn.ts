/**
 * The turn id for the run this browser is watching, read off the stream.
 *
 * The runner mints a browser turn's id (`services/runner/src/server.ts`, `resolveTurnId`), so the
 * client never composes one and had no way to name the turn it was watching. That is why Stop could
 * only say "cancel whatever is running", and why a Stop applied after its turn ended killed the
 * next one (#6417).
 *
 * The runner now emits `{type: "turn", turnId}` as its first event and the SDK forwards it verbatim
 * as a `data-agent-turn` part. It arrives third, after `start` and `start-step`, before any content.
 * It cannot ride on `start`: the SDK egress emits `start` before the runner is consulted.
 *
 * The runner half lands on `feat/session-single-turn-admission` (runner commit ce0f1e12da). Until
 * it does, no part arrives, nothing is stored, and Stop sends no guard, exactly as before.
 */
export const turnIdFromDataPart = (part: unknown): string | null => {
    if (!part || typeof part !== "object") return null
    const candidate = part as {type?: unknown; data?: {turnId?: unknown}}
    if (candidate.type !== "data-agent-turn") return null
    const turnId = candidate.data?.turnId
    return typeof turnId === "string" && turnId.trim() ? turnId : null
}
