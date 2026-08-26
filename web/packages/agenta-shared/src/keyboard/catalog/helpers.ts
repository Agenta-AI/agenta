import type {ShortcutDefinition, ShortcutId} from "../types"

export const id = (value: string): ShortcutId => value as ShortcutId

/** Keeps a catalog file to its data: every entry is a literal, `defineShortcuts` only types it. */
export const defineShortcuts = (
    entries: readonly ShortcutDefinition[],
): readonly ShortcutDefinition[] => entries
