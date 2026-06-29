interface StreamFlags {
    is_alive?: boolean
    is_running?: boolean
    is_attached?: boolean
}

export interface NestView {
    isAlive: boolean
    isRunning: boolean
    isAttached: boolean
}

export function deriveNest(flags?: StreamFlags | null): NestView {
    return {
        isAlive: Boolean(flags?.is_alive),
        isRunning: Boolean(flags?.is_running),
        isAttached: Boolean(flags?.is_attached),
    }
}
