import {SHORTCUTS} from "./catalog"
import {formatChord} from "./format"
import {SECTIONS, SECTIONS_BY_ID} from "./sections"
import type {
    ShortcutDefinition,
    ShortcutId,
    ShortcutListing,
    ShortcutSectionListing,
    SectionId,
} from "./types"

export const SHORTCUTS_BY_ID: ReadonlyMap<ShortcutId, ShortcutDefinition> = new Map(
    SHORTCUTS.map((entry) => [entry.id, entry]),
)

/** Every id, as a lookup for call sites: `SHORTCUT_IDS["gate.approve"]`. */
export const SHORTCUT_IDS = Object.freeze(
    Object.fromEntries(SHORTCUTS.map((entry) => [entry.id, entry.id])),
) as Readonly<Record<string, ShortcutId>>

export const getShortcut = (id: ShortcutId): ShortcutDefinition | null =>
    SHORTCUTS_BY_ID.get(id) ?? null

const toListing = (def: ShortcutDefinition, isMac: boolean): ShortcutListing => ({
    id: def.id,
    label: def.label,
    ...(def.context ? {context: def.context} : {}),
    chords: def.chords.map((chord) => formatChord(chord, {isMac})),
})

/** One entry, ready to render beside its own control or in a tooltip. */
export function describeShortcut(
    id: ShortcutId,
    opts: {isMac: boolean},
): ShortcutListing | null {
    const def = SHORTCUTS_BY_ID.get(id)
    return def ? toListing(def, opts.isMac) : null
}

export interface ListShortcutsOptions {
    isMac: boolean
    /** Restrict to some sections; omit for all. */
    sections?: readonly SectionId[]
    /** Include `reference: "hidden"` entries. Debug only. */
    includeHidden?: boolean
}

/**
 * The whole catalog, grouped, sorted and formatted for this platform — the data a shortcuts
 * reference renders verbatim. Empty sections are dropped, so a filtered call never leaves a
 * bare heading behind.
 */
export function listShortcutSections(
    opts: ListShortcutsOptions,
): ShortcutSectionListing[] {
    const {isMac, sections, includeHidden = false} = opts
    const wanted = sections ? new Set(sections) : null

    const bySection = new Map<SectionId, ShortcutDefinition[]>()
    SHORTCUTS.forEach((def) => {
        if (wanted && !wanted.has(def.section)) return
        if (!includeHidden && def.reference === "hidden") return
        const bucket = bySection.get(def.section)
        if (bucket) bucket.push(def)
        else bySection.set(def.section, [def])
    })

    return [...SECTIONS]
        .sort((a, b) => a.order - b.order)
        .flatMap((section) => {
            const entries = bySection.get(section.id)
            if (!entries?.length) return []
            // Catalog order is the tie-break, so the listing is stable across renders and can be
            // snapshotted.
            const ordered = entries
                .map((def, index) => ({def, index}))
                .sort(
                    (a, b) =>
                        (a.def.order ?? 0) - (b.def.order ?? 0) || a.index - b.index,
                )
                .map(({def}) => toListing(def, isMac))
            return [
                {
                    id: section.id,
                    title: section.title,
                    ...(section.summary ? {summary: section.summary} : {}),
                    shortcuts: ordered,
                },
            ]
        })
}

/** Catalog invariants, asserted by the unit tests rather than at import time. */
export function validateCatalog(): string[] {
    const problems: string[] = []
    const seen = new Set<string>()

    SHORTCUTS.forEach((def) => {
        if (seen.has(def.id)) problems.push(`duplicate id: ${def.id}`)
        seen.add(def.id)
        if (!SECTIONS_BY_ID.has(def.section)) {
            problems.push(`${def.id}: unknown section "${def.section}"`)
        }
        if (!def.label.trim()) problems.push(`${def.id}: empty label`)
        def.chords.forEach((chord) => {
            if (chord.alt === "required" && chord.target.kind !== "physical") {
                // macOS turns Option+1 into "¡" and Option+Z into "Ω": the letter is gone.
                problems.push(`${def.id}: an Alt chord must name a physical key`)
            }
        })
    })

    return problems
}
