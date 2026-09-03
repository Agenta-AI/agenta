// Utility function to build deterministic slug keys identical to backend implementation
// Combines a sanitized, kebab-cased version of `name` with the last 4 chars of `id`.
// Keeps logic in one place so it can be reused across services/hooks without duplication.

// Sanitized, kebab-cased base (no suffix): single source of truth in @agenta/shared.
import {slugifyBase} from "@agenta/shared/utils"

export const slugify = (name: string, id: string): string => {
    const suffix = id?.slice(-12) || ""
    return `${slugifyBase(name)}-${suffix}`
}
