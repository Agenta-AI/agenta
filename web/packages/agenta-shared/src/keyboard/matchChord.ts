import type {Chord, KeyEventLike, ModState, ShortcutDefinition} from "./types"

/** Names the same physical key reports under, so a chord can spell either one. */
const KEY_ALIASES: Record<string, string> = {
    " ": "space",
    spacebar: "space",
    esc: "escape",
    del: "delete",
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
}

const normalizeKey = (raw: string): string => {
    const lower = raw.toLowerCase()
    return KEY_ALIASES[lower] ?? lower
}

/** An unspecified modifier is forbidden — see the note on `ModState`. */
const satisfies = (state: ModState | undefined, held: boolean): boolean =>
    state === "required" ? held : !held

export function matchesChord(chord: Chord, event: KeyEventLike, isMac: boolean): boolean {
    const {target} = chord
    if (target.kind === "physical") {
        if (event.code !== target.code) return false
    } else if (normalizeKey(event.key) !== normalizeKey(target.key)) {
        return false
    }

    // `mod` is the "⌘ or Ctrl" story; a chord that means one of them literally says so, and that
    // spelling wins for that modifier.
    const metaState = chord.meta ?? (isMac ? chord.mod : undefined)
    const ctrlState = chord.ctrl ?? (isMac ? undefined : chord.mod)

    return (
        satisfies(metaState, event.metaKey) &&
        satisfies(ctrlState, event.ctrlKey) &&
        satisfies(chord.alt, event.altKey) &&
        satisfies(chord.shift, event.shiftKey)
    )
}

export interface MatchContext {
    isMac: boolean
    /** Focus is in an input, textarea, or contenteditable. */
    typingTarget: boolean
}

export function passesGuards(def: ShortcutDefinition, event: KeyEventLike, ctx: MatchContext): boolean {
    const guards = def.guards
    if (event.repeat && !guards?.allowRepeat) return false
    if (event.isComposing && !guards?.allowComposing) return false
    if (!ctx.typingTarget) return true

    switch (guards?.typing ?? "block") {
        case "allow":
            return true
        // Mirrors the approval card: `⌘↵` still fires from a field, `Escape` does not.
        case "allow-with-mod":
            return ctx.isMac ? event.metaKey : event.ctrlKey
        default:
            return false
    }
}

export function matchesShortcut(
    def: ShortcutDefinition,
    event: KeyEventLike,
    ctx: MatchContext,
): boolean {
    if (!def.chords.some((chord) => matchesChord(chord, event, ctx.isMac))) return false
    return passesGuards(def, event, ctx)
}

/**
 * A bare Alt chord: no AltGr (Ctrl+Alt), no Cmd or Shift, not a repeat or an IME keystroke.
 * Lives here rather than with the session hook so the catalog and the hook share one definition.
 */
export const isAltChord = (e: KeyEventLike): boolean =>
    e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !e.isComposing
