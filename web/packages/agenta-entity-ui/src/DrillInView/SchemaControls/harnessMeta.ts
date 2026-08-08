/**
 * Harness display identity, shared by every surface that lists harnesses — the config drawer's
 * select and rail, and the chat composer's `/harness` palette. One home so a harness can't be
 * hidden in one picker and offered in another.
 */
import {formatEnumLabel} from "@agenta/shared/utils"

export interface HarnessMeta {
    label: string
    /** 1–2 char monogram shown in the avatar. */
    short: string
    /** Avatar background colour. */
    color: string
}

/**
 * Avatar identity (brand colour + monogram) per harness id. Labels come from the schema `oneOf`
 * title when present; these defaults only supply the avatar and a label fallback. Keyed by the real
 * enum values `pi_core` / `pi_agenta` / `claude`.
 */
export const HARNESS_META: Record<string, HarnessMeta> = {
    pi_core: {label: "Pi", short: "Pi", color: "#6b5bd6"},
    pi_agenta: {label: "Pi (Agenta)", short: "Ag", color: "#1c2c3d"},
    claude: {label: "Claude Code", short: "CC", color: "#d97757"},
    codex: {label: "Codex", short: "Cx", color: "#10a37f"},
}

/** Harnesses never offered in a picker. */
export const HIDDEN_HARNESSES = new Set(["pi_agenta"])

/** Resolve display identity, deriving a sensible fallback for unknown harness ids. */
export function harnessMetaFor(value: string): HarnessMeta {
    const known = HARNESS_META[value]
    if (known) return known
    const label = formatEnumLabel(value)
    const short =
        label
            .replace(/[^A-Za-z0-9]/g, "")
            .slice(0, 2)
            .toUpperCase() || "?"
    return {label, short, color: "#586673"}
}

/** The harness ids a picker may offer, from the capability catalog. */
export function selectableHarnesses(harnessIds: string[]): string[] {
    return harnessIds.filter((id) => !HIDDEN_HARNESSES.has(id))
}
