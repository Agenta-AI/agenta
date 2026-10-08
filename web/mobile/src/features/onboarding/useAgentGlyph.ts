import {useEffect, useMemo, useState} from "react"

import {loadAgentIconCatalog, type PhosphorCatalogEntry} from "@agenta/ui/agent-icon"

/** Every catalog glyph's SVG markup by name; empty until the lazy catalog chunk answers. */
export const useGlyphPaths = (): ReadonlyMap<string, string> => {
    const [catalog, setCatalog] = useState<PhosphorCatalogEntry[] | null>(null)
    useEffect(() => {
        let live = true
        void loadAgentIconCatalog()
            .then((entries) => {
                if (live) setCatalog(entries)
            })
            .catch(() => undefined)
        return () => {
            live = false
        }
    }, [])
    return useMemo(
        () => new Map((catalog ?? []).map((entry) => [entry.name, entry.path])),
        [catalog],
    )
}

/** One glyph's SVG markup by catalog name; `null` until the catalog answers. */
export const useAgentGlyph = (name: string): string | null => useGlyphPaths().get(name) ?? null
