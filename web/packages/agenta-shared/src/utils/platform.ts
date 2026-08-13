/**
 * Apple-platform detection, for surfaces that must name a modifier key the way the user's own
 * keyboard does (⌘ vs Ctrl). One definition so hints and keybindings can't disagree.
 *
 * Server-side there is no platform to read, so this returns false; call it from a mount effect
 * (not during render) wherever the answer reaches the DOM, or hydration will mismatch.
 */
export function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") return false
    const platform =
        (navigator as Navigator & {userAgentData?: {platform?: string}}).userAgentData?.platform ||
        navigator.platform ||
        navigator.userAgent
    return /Mac|iPhone|iPad|iPod/i.test(platform)
}

/** The modifier key's display glyph on this platform: `⌘` on Apple hardware, `Ctrl` elsewhere. */
export const modifierKeyLabel = (): string => (isMacPlatform() ? "⌘" : "Ctrl")

/**
 * What an Alt chord is prefixed with on this platform: `⌥` on Apple hardware, `Alt+` elsewhere.
 * The separator belongs here, not at the call sites, or `⌥R` reads correctly on a Mac while every
 * other platform prints `AltR`.
 */
export const altKeyPrefix = (): string => (isMacPlatform() ? "⌥" : "Alt+")
