interface StreamFlags {
    is_alive?: boolean
    is_running?: boolean
    is_attached?: boolean
}

export interface NestView {
    isAlive: boolean
    isRunning: boolean
    isAttached: boolean
    /** alive & !running — idle, send without force. */
    resumable: boolean
    /** running & !attached — running with nobody watching; attach to watch. */
    reattachable: boolean
}

/** Derive the nest view from the primitive flags (resumable/reattachable are client-side). */
export function deriveNest(flags?: StreamFlags | null): NestView {
    const isAlive = Boolean(flags?.is_alive)
    const isRunning = Boolean(flags?.is_running)
    const isAttached = Boolean(flags?.is_attached)
    return {
        isAlive,
        isRunning,
        isAttached,
        resumable: isAlive && !isRunning,
        reattachable: isRunning && !isAttached,
    }
}
