/**
 * The platform's `AudioContext`, under whichever name it has here.
 *
 * Shared because two features build an analysis graph — recording a voice message and dictating —
 * and a second copy of the prefix dance is a second place for Safari to be forgotten.
 */
export const getAudioContextCtor = (): typeof AudioContext | undefined => {
    if (typeof window === "undefined") return undefined
    const w = window as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
    }
    return w.AudioContext ?? w.webkitAudioContext
}
