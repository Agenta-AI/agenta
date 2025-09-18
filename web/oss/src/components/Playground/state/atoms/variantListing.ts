/**
 * Variant listing atoms
 * Scope: flat variant lists for simple UIs (e.g., create-new-variant modal).
 */
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import groupBy from "lodash/groupBy"

import {appTypeAtom} from "./app"
import {revisionListAtom} from "./variants"

/**
 * Creates a focused atom for variant list display (used by PlaygroundHeader)
 * Only includes essential data needed for SelectVariant component
 */
export const variantListDisplayAtom = atom((get) => {
    const revisions = get(revisionListAtom) || []
    const byVariant = groupBy(revisions, "variantId")
    return Object.values(byVariant).map((list: any[]) => {
        const latest = list.sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
        const appType = get(appTypeAtom)
        const isChat = appType === "chat"
        return {
            id: latest.id,
            name: latest.variantName,
            isChat,
        }
    })
})

/**
 * FILTERED SELECTORS
 * Centralize common filters to avoid component-level filtering and wide subscriptions
 */
export const variantListDisplayFilteredAtomFamily = atomFamily((searchTerm: string) =>
    selectAtom(
        variantListDisplayAtom,
        (list) => {
            if (!searchTerm) return list
            const lower = searchTerm.toLowerCase()
            return list.filter((v: any) => (v?.name || "").toLowerCase().includes(lower))
        },
        isEqual,
    ),
)
