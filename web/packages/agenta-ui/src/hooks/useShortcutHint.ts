import {useMemo} from "react"

import {
    describeShortcut,
    listShortcutSections,
    type SectionId,
    type ShortcutId,
    type ShortcutListing,
    type ShortcutSectionListing,
} from "@agenta/shared/keyboard"

import {useShortcutPlatform} from "./useShortcutPlatform"

/** One catalog entry, spelled for this viewer. */
export function useShortcutHint(id: ShortcutId): ShortcutListing | null {
    const {isMac} = useShortcutPlatform()
    return useMemo(() => describeShortcut(id, {isMac}), [id, isMac])
}

/**
 * The catalog grouped for a shortcuts reference: headings, then rows of an action name and the
 * keys that run it. A screen renders this straight — it needs no knowledge of the catalog.
 */
export function useShortcutSections(opts?: {
    sections?: readonly SectionId[]
}): ShortcutSectionListing[] {
    const {isMac} = useShortcutPlatform()
    const sections = opts?.sections
    return useMemo(() => listShortcutSections({isMac, sections}), [isMac, sections])
}
