import type {TemplateImportStart} from "@agenta/home-ui"
import {atom} from "jotai"

import {newId} from "@/lib/ids"

interface ImportTemplateRequest {
    /** A new id per request remounts the dialog, so each import starts clean. */
    id: string
    start: TemplateImportStart
    open: boolean
}

/** The one Create-agent-from-template dialog, opened from any entry and mounted once in AppShell. */
export const importTemplateRequestAtom = atom<ImportTemplateRequest | null>(null)

export const openImportTemplateAtom = atom(null, (_get, set, start: TemplateImportStart) =>
    set(importTemplateRequestAtom, {id: newId(), start, open: true}),
)
