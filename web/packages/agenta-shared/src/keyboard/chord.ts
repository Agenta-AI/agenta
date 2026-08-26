import type {Chord, KeyRef} from "./types"

/** A key named by what it produces (`event.key`). Compared case-insensitively. */
export const key = (k: string): KeyRef => ({kind: "logical", key: k})

/**
 * A key named by where it sits (`event.code`). Required for every Alt chord: macOS reports
 * Option+1 as `¡` and Option+Z as `Ω`, so the letter is gone by the time the event arrives.
 */
export const code = (c: string): KeyRef => ({kind: "physical", code: c})

/** A chord with no modifier unless one is spelled out. */
export const bare = (target: KeyRef, extra?: Omit<Chord, "target">): Chord => ({target, ...extra})

/** `⌘`+key on Apple hardware, `Ctrl`+key elsewhere. */
export const modChord = (target: KeyRef, extra?: Omit<Chord, "target" | "mod">): Chord => ({
    target,
    mod: "required",
    ...extra,
})

/** `⌥`+key on Apple hardware, `Alt`+key elsewhere. Leaving `ctrl` unspecified — and so
 * forbidden — is what keeps European AltGr, which reports as Ctrl+Alt, typing normally. */
export const altChord = (target: KeyRef, extra?: Omit<Chord, "target" | "alt">): Chord => ({
    target,
    alt: "required",
    ...extra,
})
