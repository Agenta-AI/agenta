import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {variantByRevisionIdAtomFamily} from "./propertySelectors"

// Legacy local prompts cache has been removed. Use `promptsAtomFamily` for all reads/writes.

// Bumped on store revalidation or when metadata changes impacting transforms
export const metadataVersionAtom = atom(0)

// Memoized ag_config builder from local prompts + baseline (removed)

// Minimal selector: isCustom flag for a revision's variant
export const variantIsCustomAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Prefer derived flags (schema + app type + custom props) over raw variant field
        const flags = get(variantFlagsAtomFamily({revisionId})) as any
        if (flags && typeof flags.isCustom === "boolean") return flags.isCustom
        const v: any = get(variantByRevisionIdAtomFamily(revisionId))
        return Boolean(v?.isCustom)
    }),
)

// Deprecated transitional atoms removed. Use selectors in `propertySelectors.ts` instead.
