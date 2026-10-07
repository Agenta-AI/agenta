import {useEffect, useState} from "react"

import {loadAgentIconCatalog, type PhosphorCatalogEntry} from "@agenta/ui/agent-icon"

/** A glyph's SVG markup by catalog name; `null` until the lazy catalog chunk answers. */
export const useAgentGlyph = (name: string): string | null => {
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
    return catalog?.find((entry) => entry.name === name)?.path ?? null
}
